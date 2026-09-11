'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Building2, ClipboardCheck, HardHat, Loader2, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { SearchHit } from '@/app/api/search/route';
import { cn } from '@/lib/utils';

const ICONS = {
  site: Building2,
  worker: HardHat,
  indent: ClipboardCheck,
} as const;

const KIND_LABEL = {
  site: 'Site',
  worker: 'Worker',
  indent: 'Indent',
} as const;

/**
 * Header search. Opens on click or ⌘K / Ctrl-K.
 *
 * Queries are debounced and each one aborts the last, so a fast typist never has
 * an early response overwrite a later one — the classic out-of-order race that
 * makes a search box show results for the wrong word.
 */
export function SearchCommand() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as { hits: SearchHit[] };
        setHits(payload.hits);
        setActive(0);
      } catch {
        /* aborted or offline — leave the previous results in place */
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  function go(hit: SearchHit) {
    setOpen(false);
    router.push(hit.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && hits[active]) {
      event.preventDefault();
      go(hits[active]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 min-h-0 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-[13.5px] text-ink-faint transition hover:border-ink-faint lg:flex"
      >
        <Search className="size-4" />
        <span>Search sites, workers, indents</span>
        <kbd className="ml-6 rounded-[5px] border border-line px-1.5 font-mono text-[11px] text-ink-faint">
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="flex size-9 min-h-0 items-center justify-center rounded-control border border-line-strong text-ink-muted transition hover:bg-raised lg:hidden"
      >
        <Search className="size-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogTitle className="sr-only">Search</DialogTitle>

          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 flex-none text-ink-faint" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search sites, workers, indents…"
              className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-faint"
            />
            {loading && <Loader2 className="size-4 flex-none animate-spin text-ink-faint" />}
          </div>

          <div className="max-h-[320px] overflow-y-auto p-2">
            {query.trim().length < 2 ? (
              <p className="px-3 py-6 text-center text-[13.5px] text-ink-muted">
                Type at least two letters.
              </p>
            ) : hits.length === 0 && !loading ? (
              <p className="px-3 py-6 text-center text-[13.5px] text-ink-muted">
                Nothing matches “{query}”.
              </p>
            ) : (
              hits.map((hit, index) => {
                const Icon = ICONS[hit.kind];
                return (
                  <button
                    key={`${hit.kind}-${hit.id}`}
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(hit)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-btn px-3 py-2.5 text-left transition',
                      index === active ? 'bg-raised' : 'hover:bg-raised',
                    )}
                  >
                    <span className="flex size-8 flex-none items-center justify-center rounded-btn bg-neutral-bg text-ink-soft">
                      <Icon className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px] font-medium">{hit.label}</span>
                      <span className="truncate text-[12.5px] text-ink-muted">{hit.sublabel}</span>
                    </span>
                    <span className="flex-none text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                      {KIND_LABEL[hit.kind]}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
