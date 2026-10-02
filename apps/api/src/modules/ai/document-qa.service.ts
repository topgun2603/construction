import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import OpenAI from 'openai';
import type { AskDocumentsInput, AskDocumentsResult, DocumentCitation } from '@sitebook/shared';
import { env } from '../../config/env';
import { ApiError } from '../../common/errors/api-error';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { JobQueueService } from '../../jobs/job-queue.service';
import type { RequestUser } from '../../common/auth/request-user';

/** How many pages are retrieved and shown to the model. */
const RETRIEVE = 8;

/** How much of a matching page is quoted back in the interface. */
const SNIPPET_CHARS = 280;

/**
 * Answering a question from the documents somebody has uploaded.
 *
 * Retrieval, not recall, and the difference is the whole safety argument. The model is never asked
 * "what is the slab thickness" — it is shown eight pages of the builder's own drawings that match
 * those words and asked what they say. It cannot answer about a document outside the asker's
 * project scope, because the search that selects those pages runs under that scope before the model
 * exists in the story. And it cannot invent a figure, because the only text it has is text that
 * came out of a PDF.
 *
 * Every answer carries the document, the page and the words it came from. That is not decoration:
 * on a site, an answer about a slab that nobody can check in ten seconds is an answer nobody should
 * act on, and a page number is what makes checking it ten seconds rather than twenty minutes.
 */
@Injectable()
export class DocumentQaService {
  private readonly logger = new Logger(DocumentQaService.name);
  private readonly config = env();
  private client?: OpenAI;

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly jobs: JobQueueService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.OPENAI_API_KEY);
  }

  async ask(actor: RequestUser, input: AskDocumentsInput): Promise<AskDocumentsResult> {
    if (input.project_id) await this.access.assertAccess(actor, input.project_id);

    const matches = await this.retrieve(actor, input);
    const waiting = await this.queueUnread(actor, input);

    if (matches.length === 0) {
      /*
       * Nothing matched, and *why* nothing matched is the useful part.
       *
       * "Not in the documents" and "your documents are photographs of documents" look identical
       * from here and mean completely different things to whoever has to find the answer. The
       * second one tells them to go and ask the consultant instead of asking again differently.
       */
      return {
        answer: 'Nothing in the documents here matches that.',
        answered: false,
        sources: [],
        caveat: waiting ?? (await this.noTextCaveat(actor, input)),
      };
    }

    /*
     * The key is checked here, not at the top.
     *
     * Everything above this line is the builder's own database: the search, and queueing anything
     * that has not been read. A deployment with no key can still index documents and still say
     * "there are no documents here yet" — and a tenant with an empty register never reaches a
     * vendor at all, which is a bill nobody should get for a question about nothing.
     */
    if (!this.enabled) {
      throw ApiError.conflict('Asking the documents is not configured on this deployment');
    }

    const read = await this.readPages(input.question, matches);

    return {
      answer: read.answer,
      answered: read.answered,
      // Only the pages the model actually cited. Listing all eight would make a precise answer look
      // like a guess across a folder, and the whole point is that it is neither.
      sources: read.used.map((index) => citationFor(matches[index]!)),
      caveat: waiting,
    };
  }

  /**
   * The pages that match the question, ranked, under the asker's own scope.
   *
   * Postgres full-text rather than embeddings, deliberately. A drawing register is tens of
   * thousands of words, not millions; the questions are about dimensions, grades, clauses and
   * rates, which are literal terms that match literally; and this needs no second datastore to
   * keep in step with RLS. An embedding index would be a better answer to a question nobody here
   * is asking, and a worse answer to "which page says 150mm".
   */
  private async retrieve(
    actor: RequestUser,
    input: AskDocumentsInput,
  ): Promise<Match[]> {
    const query = toTsQuery(input.question);
    if (!query) return [];

    /*
     * Scope, in SQL, before the model.
     *
     * RLS already bounds this to the tenant. This bounds it to the sites the asker is on — a
     * supervisor asking the register must not be answered from the drawings of a site they were
     * taken off. A company-wide document (`project_id IS NULL`) is visible to everybody in the
     * tenant, which is what "company-wide" means.
     */
    const scope = actor.seesAllProjects
      ? Prisma.sql`TRUE`
      : Prisma.sql`(d.project_id IS NULL OR d.project_id = ANY(${actor.projectIds}::uuid[]))`;

    const narrow = input.document_id
      ? Prisma.sql`AND d.id = ${input.document_id}::uuid`
      : input.project_id
        ? Prisma.sql`AND d.project_id = ${input.project_id}::uuid`
        : Prisma.empty;

    /*
     * Through `transaction`, not `clientFor`.
     *
     * `clientFor` sets `app.tenant_id` by intercepting *model* operations, and `$queryRaw` is not
     * one — a raw query on that client runs with no tenant set, and under FORCE RLS a query with no
     * tenant set reads nothing. It would look like "no documents match" forever, which is the kind
     * of bug that survives a demo. The interactive transaction sets it for real.
     */
    return this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.$queryRaw<Match[]>(Prisma.sql`
      SELECT c.document_id, c.page, c.content, d.title, p.name AS project_name,
             ts_rank(to_tsvector('english', c.content), to_tsquery('english', ${query})) AS rank
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE to_tsvector('english', c.content) @@ to_tsquery('english', ${query})
        AND ${scope}
        ${narrow}
      ORDER BY rank DESC, c.page ASC
      LIMIT ${RETRIEVE}
      `),
    );
  }

  /**
   * The one model call. It reads the retrieved pages and nothing else.
   *
   * `used` is a list of indexes into the pages it was given, which is why a citation cannot be
   * fabricated: the document title and page number are looked up here from the row that was
   * retrieved, not taken from anything the model wrote.
   */
  private async readPages(
    question: string,
    matches: Match[],
  ): Promise<{ answer: string; answered: boolean; used: number[] }> {
    const context = matches
      .map((match, index) => `[${index}] ${match.title}, page ${match.page}:\n${match.content}`)
      .join('\n\n---\n\n');

    let raw: string;
    try {
      const response = await this.openai().chat.completions.create({
        model: this.config.OPENAI_DOCUMENT_MODEL,
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Question: ${question}\n\nExtracts:\n\n${context}` },
        ],
      });
      raw = response.choices[0]?.message?.content ?? '';
    } catch (error) {
      this.logger.warn({ err: error }, 'Document question failed at the vendor');
      throw ApiError.conflict('Could not read that question. Try asking it another way.');
    }

    let json: { answer?: unknown; found?: unknown; used?: unknown };
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      throw ApiError.conflict('Could not read that question. Try asking it another way.');
    }

    const answer = typeof json.answer === 'string' ? json.answer.trim() : '';
    const answered = json.found === true && answer.length > 0;

    return {
      answer: answered ? answer : 'The documents here do not say.',
      answered,
      // Indexes only, bounded to what was actually retrieved. A model that cites `[12]` out of
      // eight pages is citing nothing, and a citation to nothing must not reach the screen.
      used: answered
        ? [...new Set((Array.isArray(json.used) ? json.used : []).map(Number))]
            .filter((index) => Number.isInteger(index) && index >= 0 && index < matches.length)
            .slice(0, 4)
        : [],
    };
  }

  /**
   * Documents nobody has read yet get queued, and the asker is told.
   *
   * Self-healing rather than a migration. Everything uploaded before this feature existed has no
   * text, and the first question about a site is what notices — so it queues them and says "two
   * documents are still being read", which is true and will be false in a few seconds.
   */
  private async queueUnread(
    actor: RequestUser,
    input: AskDocumentsInput,
  ): Promise<string | null> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const unread = await db.document.findMany({
      where: {
        deletedAt: null,
        textExtractedAt: null,
        contentType: 'application/pdf',
        ...(input.document_id ? { id: input.document_id } : {}),
        ...(input.project_id ? { projectId: input.project_id } : {}),
        ...(actor.seesAllProjects ? {} : { OR: [{ projectId: null }, ...this.orScope(actor)] }),
      },
      select: { id: true, s3Key: true, contentType: true },
      take: 25,
    });
    if (unread.length === 0) return null;

    for (const document of unread) {
      await this.jobs.extractDocumentText({
        tenantId: actor.tenantId,
        documentId: document.id,
        s3Key: document.s3Key,
        contentType: document.contentType,
      });
    }
    return unread.length === 1
      ? 'One document has not been read yet. Ask again in a moment and it will be included.'
      : `${unread.length} documents have not been read yet. Ask again in a moment and they will be included.`;
  }

  /** Whether the register is all scans — which is why a question found nothing. */
  private async noTextCaveat(
    actor: RequestUser,
    input: AskDocumentsInput,
  ): Promise<string | null> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const where = {
      deletedAt: null,
      ...(input.document_id ? { id: input.document_id } : {}),
      ...(input.project_id ? { projectId: input.project_id } : {}),
    };
    const [total, readable] = await Promise.all([
      db.document.count({ where }),
      db.document.count({ where: { ...where, textPages: { gt: 0 } } }),
    ]);

    if (total === 0) return 'There are no documents here yet.';
    if (readable === 0) {
      return 'None of these documents have text in them — they are scans or photographs, and there is nothing to search.';
    }
    return null;
  }

  private orScope(actor: RequestUser): { projectId: { in: string[] } }[] {
    return [{ projectId: { in: actor.projectIds } }];
  }

  private openai(): OpenAI {
    this.client ??= new OpenAI({ apiKey: this.config.OPENAI_API_KEY });
    return this.client;
  }
}

interface Match {
  document_id: string;
  page: number;
  content: string;
  title: string;
  project_name: string | null;
  rank: number;
}

function citationFor(match: Match): DocumentCitation {
  return {
    document_id: match.document_id,
    title: match.title,
    project_name: match.project_name,
    page: match.page,
    snippet:
      match.content.length > SNIPPET_CHARS
        ? `${match.content.slice(0, SNIPPET_CHARS).trimEnd()}…`
        : match.content,
  };
}

/**
 * A question into a Postgres text query.
 *
 * `OR` of the terms, not `AND`. `websearch_to_tsquery` would require every word, and "what is the
 * slab thickness on the third floor" shares all six content words with no single drawing note —
 * requiring all of them answers nothing. Ranking is what sorts the wheat: a page holding "slab"
 * and "thickness" together outranks one that merely mentions a floor.
 *
 * Terms are reduced to letters and digits before they reach `to_tsquery`, which otherwise treats
 * `&`, `|`, `!` and `:` as operators — that is an injection into the query language, not into SQL,
 * and it would turn a question containing an ampersand into a syntax error.
 */
export function toTsQuery(question: string): string | null {
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));

  // Twelve is plenty: beyond that the ranking is being set by filler, and the query gets slower.
  const unique = [...new Set(terms)].slice(0, 12);
  return unique.length > 0 ? unique.join(' | ') : null;
}

/**
 * Words that carry no retrieval value in a question.
 *
 * Postgres drops English stop words itself, but `to_tsquery('english', 'the | a')` on a question
 * made entirely of them yields an empty query and a confusing warning. Filtering here means a
 * question like "what is it" is recognised as asking nothing searchable, before the database.
 */
const STOP_WORDS = new Set([
  'what', 'whats', 'which', 'where', 'when', 'who', 'how', 'why', 'is', 'are', 'was', 'were',
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'it', 'its', 'this',
  'that', 'there', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'me', 'my', 'we',
  'our', 'us', 'you', 'your', 'tell', 'show', 'give', 'say', 'says', 'said', 'any', 'all',
  'be', 'been', 'has', 'have', 'had', 'will', 'shall', 'much', 'many', 'about',
]);

const SYSTEM_PROMPT = `You answer a construction manager's question using ONLY the numbered extracts from their own project documents. Return JSON and nothing else.

Keys:
  found  - true if the extracts answer the question, false if they do not.
  answer - the answer in at most three sentences, quoting figures exactly as the extracts print them. Empty string when found is false.
  used   - the numbers of the extracts the answer came from, e.g. [0, 3]. Empty when found is false.

Rules:
  Use nothing but the extracts. You have no other knowledge of this project.
  Never estimate, never convert units, never average, and never infer a figure that is not printed. If the extracts give a range or disagree, say so and cite both.
  If the extracts do not answer the question, set found to false. That is a correct and useful answer — a guess about a structural dimension is not.
  Quote numbers, grades and clause references character for character: M25, 150mm, Cl. 7.3.2.
  Do not mention the extracts, the numbering, or that you were given context. Answer as if reading the drawing.`;
