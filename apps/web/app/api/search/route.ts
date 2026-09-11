import { NextResponse, type NextRequest } from 'next/server';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import type { Indent, Page, ProjectSummary, Worker } from '@/lib/api-types';

export interface SearchHit {
  id: string;
  kind: 'site' | 'worker' | 'indent';
  label: string;
  sublabel: string;
  href: string;
}

/**
 * Backs the header search.
 *
 * A route handler rather than a server action because it runs on every keystroke:
 * actions are POSTs that serialise behind the router, which makes typing feel
 * laggy. The session cookie is read here, so no API token reaches the browser.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (query.length < 2) return NextResponse.json({ hits: [] });

  const encoded = encodeURIComponent(query);

  try {
    const [projects, workers, indents] = await Promise.all([
      // `throw`, not redirect: this answers a background fetch() from the search
      // box, and a 307 would come back as HTML the client tries to parse as JSON.
      serverFetch<Page<ProjectSummary>>(`/projects?q=${encoded}&limit=5`, {
        onUnauthenticated: 'throw',
      }),
      serverFetch<Page<Worker>>(`/workers?q=${encoded}&limit=5`, {
        onUnauthenticated: 'throw',
      }),
      // Indents have no text search, so the filter is applied here over a small
      // recent page — enough to find "the cement one" without a new endpoint.
      serverFetch<Page<Indent>>('/indents?limit=40', { onUnauthenticated: 'throw' }),
    ]);

    const needle = query.toLowerCase();

    const hits: SearchHit[] = [
      ...projects.items.map((project) => ({
        id: project.id,
        kind: 'site' as const,
        label: project.name,
        sublabel: [project.address, project.client_name].filter(Boolean).join(' · ') || 'Site',
        href: `/projects/${project.id}`,
      })),
      ...workers.items.map((worker) => ({
        id: worker.id,
        kind: 'worker' as const,
        label: worker.name,
        sublabel: [worker.trade, worker.contractor_name ?? 'Direct labour']
          .filter(Boolean)
          .join(' · '),
        href: '/labour/workers',
      })),
      ...indents.items
        .filter(
          (indent) =>
            indent.project_name.toLowerCase().includes(needle) ||
            indent.items.some((item) => item.material_name.toLowerCase().includes(needle)),
        )
        .slice(0, 5)
        .map((indent) => ({
          id: indent.id,
          kind: 'indent' as const,
          label: indent.items.map((item) => item.material_name).join(', '),
          sublabel: `${indent.project_name} · ${indent.status}`,
          href: '/indents',
        })),
    ];

    return NextResponse.json({ hits });
  } catch (error) {
    // A module the tenant does not have returns 403; that is not a search failure,
    // it just means there is nothing of that kind to find.
    if (error instanceof ApiRequestError && error.status === 403) {
      return NextResponse.json({ hits: [] });
    }
    if (error instanceof ApiRequestError && error.status === 401) {
      return NextResponse.json({ hits: [] }, { status: 401 });
    }
    throw error;
  }
}
