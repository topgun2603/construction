import { Injectable, Logger } from '@nestjs/common';

/**
 * Reads the text out of an uploaded document, a page at a time.
 *
 * This is the unglamorous half of answering questions about drawings, and the half that decides
 * whether the feature works at all. A builder's document register is mostly PDFs produced by
 * software — AutoCAD plots, a consultant's structural report, a supplier's rate contract — and
 * every one of those carries its text inside the file. Extracting it costs nothing per question
 * and gives an exact page number, which is worth more to somebody on site than a paraphrase.
 *
 * What it cannot read it says so about. A photographed plan or a flatbed scan of a blueprint has no
 * text layer, and no amount of parsing invents one: those come back as zero pages, which the
 * caller reports honestly rather than treating as a failure to retry.
 */
/**
 * How much of one page goes into one chunk.
 *
 * Pages are the natural unit — a citation is only useful if it names one — but a dense
 * specification page runs to six thousand characters, and retrieving six of those to answer one
 * question means most of what is sent to the model is irrelevant. Splitting at paragraph breaks
 * inside a long page keeps the citation accurate and the context tight.
 */
const CHUNK_CHARS = 1_600;

/** Below this, a "page" is a title block and a drawing number — nothing to retrieve. */
const MIN_CHARS = 40;

/**
 * A ceiling on pages read.
 *
 * A 400-page tender document is real and is not what this feature is for. Reading the first
 * hundred pages of one is better than refusing it, and far better than holding a worker for a
 * minute on a file nobody will ask about.
 */
const MAX_PAGES = 120;

@Injectable()
export class DocumentTextService {
  private readonly logger = new Logger(DocumentTextService.name);

  /**
   * Every readable chunk of a document, in order.
   *
   * Returns an empty array for a file with no text layer — a scan, a photograph — rather than
   * throwing. The caller records that it was read and found nothing, so it is not retried forever.
   */
  async chunksOf(
    file: Buffer,
    contentType: string,
  ): Promise<{ page: number; ordinal: number; content: string }[]> {
    if (contentType !== 'application/pdf') return [];

    const pages = await this.pageTexts(file);
    const chunks: { page: number; ordinal: number; content: string }[] = [];

    for (const [index, text] of pages.entries()) {
      const page = index + 1;
      for (const [ordinal, content] of split(text).entries()) {
        if (content.length >= MIN_CHARS) {
          chunks.push({ page, ordinal, content });
        }
      }
    }
    return chunks;
  }

  /**
   * One string per page, in page order.
   *
   * `pdfjs-dist` is imported where it is used, not at the top of the file. It is several megabytes
   * of module graph, and an API process that never reads a document should not pay for it at boot
   * — the same reason the bill reader imports its rasteriser lazily.
   */
  private async pageTexts(file: Buffer): Promise<string[]> {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const loading = getDocument({
      data: new Uint8Array(file),
      // A document register holds things people were sent, and a consultant's report routinely
      // references fonts it does not embed. That must not stop the text we can reach.
      useSystemFonts: true,
      // Default, stated on purpose: a malformed object on page 30 should not abandon pages 1-29.
      stopAtErrors: false,
    });
    const document = await loading.promise;

    try {
      const count = Math.min(document.numPages, MAX_PAGES);
      const pages: string[] = [];
      for (let number = 1; number <= count; number += 1) {
        try {
          const page = await document.getPage(number);
          const content = await page.getTextContent();
          pages.push(joinItems(content.items));
          page.cleanup();
        } catch (error) {
          // One unreadable page in a sixty-page set is not a reason to lose the other fifty-nine.
          this.logger.debug({ err: error, page: number }, 'Could not read one page');
          pages.push('');
        }
      }
      return pages;
    } finally {
      // The loading task owns the worker; destroying the proxy alone leaves it running, and a few
      // hundred documents later the worker process is the reason the box is out of memory.
      await loading.destroy();
    }
  }
}

/**
 * Text items into a line of prose.
 *
 * A drawing's text layer is hundreds of positioned fragments, not sentences: "SLAB", "THK", "150".
 * pdfjs marks where a line ends, and respecting that is what makes a drawing note come back as
 * "SLAB THK 150" rather than three unrelated words a paragraph apart.
 */
function joinItems(items: unknown[]): string {
  let out = '';
  for (const item of items) {
    const entry = item as { str?: string; hasEOL?: boolean };
    if (typeof entry.str !== 'string') continue;
    out += entry.str;
    out += entry.hasEOL ? '\n' : ' ';
  }
  return out
    // Positioned fragments leave runs of spaces where the layout had gaps, and a dimension string
    // broken across four items arrives with three of them between the digits.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One page's text into retrievable pieces, splitting at a line break rather than mid-sentence. */
function split(text: string): string[] {
  const clean = text.trim();
  if (clean.length <= CHUNK_CHARS) return clean ? [clean] : [];

  const pieces: string[] = [];
  let rest = clean;
  while (rest.length > CHUNK_CHARS) {
    const window = rest.slice(0, CHUNK_CHARS);
    // Prefer a paragraph break, then any line break, then give up and cut — a clause split in two
    // is still findable, which is more than can be said for a chunk nobody indexed.
    const cut =
      window.lastIndexOf('\n\n') > 400
        ? window.lastIndexOf('\n\n')
        : window.lastIndexOf('\n') > 400
          ? window.lastIndexOf('\n')
          : CHUNK_CHARS;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}
