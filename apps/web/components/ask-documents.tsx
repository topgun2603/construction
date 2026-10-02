'use client';

import { useState } from 'react';
import { ArrowRight, FileSearch, Loader2 } from 'lucide-react';
import type { AskDocumentsResult } from '@sitebook/shared';
import { askDocuments } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Asks a question of the drawings and contracts on this page.
 *
 * The answer to "what is the slab thickness on the third floor" is already written down. It is on
 * page 14 of a sixty-page structural set, which on a site with one free hand means it is unknown —
 * so somebody rings the consultant, or guesses, and a guess about a slab is expensive.
 *
 * Every answer here comes with the document and the page it came from, and that is not decoration:
 * it is what lets somebody open the drawing and confirm it in ten seconds. An answer nobody can
 * check is an answer nobody should pour concrete to, so the citations are as prominent as the
 * sentence.
 */
export function AskDocuments({
  projectId,
  placeholder = 'What is the slab thickness on the third floor?',
}: {
  projectId?: string;
  placeholder?: string;
}) {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskDocumentsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 5) return;

    setAsking(true);
    setError(null);
    const answer = await askDocuments({ question: text, ...(projectId ? { project_id: projectId } : {}) });
    setAsking(false);

    if (!answer.ok || !answer.data) {
      setError(answer.error ?? 'Could not answer that just now.');
      setResult(null);
      return;
    }
    setResult(answer.data);
  }

  return (
    <section className="rounded-panel border border-line bg-raised p-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="ask-documents" className="sr-only">
          Ask the documents a question
        </label>
        <span className="relative flex-1">
          <FileSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            id="ask-documents"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={placeholder}
            maxLength={400}
            className="pl-9"
          />
        </span>
        <Button type="submit" disabled={asking || question.trim().length < 5}>
          {asking ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          {asking ? 'Reading' : 'Ask'}
        </Button>
      </form>

      <p className="mt-2 text-[12px] text-ink-muted">
        Answered from the text of your own drawings and contracts, with the page it came from.
        Scanned sheets have no text in them and cannot be searched.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 flex flex-col gap-2 rounded-panel border border-line bg-surface p-3.5">
          <p
            className={`text-[14px] leading-relaxed ${result.answered ? 'text-ink' : 'text-ink-muted'}`}
          >
            {result.answer}
          </p>

          {result.sources.length > 0 && (
            <ul className="flex flex-col gap-2 border-t border-line pt-2.5">
              {result.sources.map((source) => (
                <li key={`${source.document_id}-${source.page}`} className="flex flex-col gap-0.5">
                  <span className="text-[12px] font-medium text-ink">
                    {source.title} · page {source.page}
                    {source.project_name ? ` · ${source.project_name}` : ''}
                  </span>
                  {/* The drawing's own words, not a paraphrase. This is the line somebody reads to
                      decide whether to trust the sentence above it. */}
                  <span className="text-[12px] leading-relaxed text-ink-muted">{source.snippet}</span>
                </li>
              ))}
            </ul>
          )}

          {result.caveat && <p className="text-[12px] text-attention-fg">{result.caveat}</p>}
        </div>
      )}
    </section>
  );
}
