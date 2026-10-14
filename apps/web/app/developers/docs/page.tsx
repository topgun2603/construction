import Link from 'next/link';
import type { ReactNode } from 'react';
import { getT } from '@/lib/i18n-server';
import {
  fieldsOf,
  inlineParts,
  markdownBlocks,
  openApiUrl,
  operationsOf,
  resolveParameter,
  typeLabel,
  type JsonSchema,
  type OpenApiDocument,
  type OperationEntry,
} from '@/lib/openapi-docs';

export const metadata = { title: 'API reference · BUILDR' };
// The reference follows the API it describes: read it fresh, at most hourly cached by the API.
export const revalidate = 3600;

const API_URL = process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/v1';
// What a browser can reach, for the link to the raw document: API_URL may be an internal address.
const BROWSER_API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? API_URL;

const METHOD_TONE: Record<string, string> = {
  get: 'bg-done-bg text-done-fg',
  post: 'bg-accent-soft text-accent',
  patch: 'bg-pending-bg text-pending-fg',
  put: 'bg-pending-bg text-pending-fg',
  delete: 'bg-blocked-bg text-blocked-fg',
};

/**
 * `/developers/docs` — the public API reference, rendered here from the API's own OpenAPI document
 * (`/public/v1/openapi.json`). Public, like the document: an integrator reads it before they have a
 * key, and it holds no company data.
 *
 * Rendered on the server into plain HTML rather than with an embedded viewer (Redoc, Scalar): no
 * script from a CDN, nothing new in the bundle, and the page works with JavaScript off. Because the
 * document is the one the API serves — and the API's suite holds it to the routes that exist — the
 * reference cannot describe an endpoint that is not there.
 */
export default async function ApiReferencePage() {
  const t = await getT();
  let doc: OpenApiDocument;
  try {
    const response = await fetch(openApiUrl(API_URL), { next: { revalidate } });
    if (!response.ok) throw new Error(String(response.status));
    doc = (await response.json()) as OpenApiDocument;
  } catch {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[640px] flex-col justify-center gap-3 bg-canvas px-6 text-center">
        <h1 className="text-[20px] font-semibold">{t('The API reference is not available right now')}</h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">{t('Try again in a minute.')}</p>
      </main>
    );
  }

  const operations = operationsOf(doc);
  const schemas = Object.keys(doc.components?.schemas ?? {});
  const server = doc.servers?.[0]?.url ?? '/public/v1';

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">BUILDR</span>
            <h1 className="text-[20px] font-semibold">{doc.info.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <code className="rounded-btn border border-line bg-raised px-2 py-1 font-mono text-[12.5px]" dir="ltr">
              {server}
            </code>
            <a href={openApiUrl(BROWSER_API_URL)} className="font-medium text-accent hover:underline" dir="ltr">
              openapi.json
            </a>
            <Link href="/settings/developers" className="font-medium text-accent hover:underline">
              {t('Your API keys')}
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t('Endpoints')} className="hidden lg:block">
          <div className="sticky top-6 flex flex-col gap-1 text-[13px]">
            <a href="#introduction" className="py-1 font-semibold text-ink hover:text-accent">
              {t('Introduction')}
            </a>
            {operations.map((entry) => (
              <a key={entry.anchor} href={`#${entry.anchor}`} className="flex items-center gap-2 py-0.5 text-ink-soft hover:text-accent">
                <span className="w-10 font-mono text-[10.5px] uppercase text-ink-muted">{entry.method}</span>
                <span className="truncate font-mono text-[12px]" dir="ltr">
                  {entry.path}
                </span>
              </a>
            ))}
            <a href="#schemas" className="mt-2 py-1 font-semibold text-ink hover:text-accent">
              {t('Objects')}
            </a>
          </div>
        </nav>

        <main className="flex min-w-0 flex-col gap-10">
          <section id="introduction" className="flex flex-col gap-3">
            <Markdown text={doc.info.description ?? ''} />
          </section>

          {operations.map((entry) => (
            <Operation key={entry.anchor} doc={doc} entry={entry} labels={{
              scope: t('Scope'),
              parameters: t('Parameters'),
              body: t('Request body'),
              responses: t('Responses'),
              required: t('required'),
            }} />
          ))}

          <section id="schemas" className="flex flex-col gap-6">
            <h2 className="text-[20px] font-semibold">{t('Objects')}</h2>
            {schemas.map((name) => (
              <div key={name} id={`schema-${name}`} className="flex flex-col gap-2">
                <h3 className="font-mono text-[15px] font-semibold" dir="ltr">
                  {name}
                </h3>
                {doc.components?.schemas?.[name]?.description && (
                  <p className="text-[13.5px] leading-relaxed text-ink-soft">
                    <Inline text={doc.components.schemas[name]!.description!} />
                  </p>
                )}
                <FieldTable doc={doc} schema={{ $ref: `#/components/schemas/${name}` }} requiredLabel={t('required')} />
              </div>
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}

function Operation({
  doc,
  entry,
  labels,
}: {
  doc: OpenApiDocument;
  entry: OperationEntry;
  labels: { scope: string; parameters: string; body: string; responses: string; required: string };
}) {
  const { operation } = entry;
  const parameters = (operation.parameters ?? []).map((parameter) => resolveParameter(doc, parameter));
  const body = operation.requestBody?.content?.['application/json']?.schema;
  return (
    <section id={entry.anchor} className="flex scroll-mt-6 flex-col gap-3 border-t border-line pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-[6px] px-2 py-0.5 font-mono text-[12px] font-semibold uppercase ${METHOD_TONE[entry.method] ?? ''}`}>
          {entry.method}
        </span>
        <code className="break-all font-mono text-[15px] font-semibold" dir="ltr">
          {entry.path}
        </code>
      </div>
      {operation.summary && <h2 className="text-[17px] font-semibold">{operation.summary}</h2>}
      {operation.description && (
        <p className="max-w-3xl text-[14px] leading-relaxed text-ink-soft">
          <Inline text={operation.description} />
        </p>
      )}
      {operation['x-required-scope'] && (
        <p className="text-[13px] text-ink-muted">
          {labels.scope}: <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12.5px]">{operation['x-required-scope']}</code>
        </p>
      )}

      {parameters.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[14px] font-semibold">{labels.parameters}</h3>
          <Table>
            {parameters.map((parameter) => (
              <tr key={`${parameter.in}-${parameter.name}`} className="align-top">
                <td className="py-2 pe-4">
                  <code className="font-mono text-[12.5px] font-semibold" dir="ltr">
                    {parameter.name}
                  </code>
                  <div className="text-[11.5px] text-ink-muted">
                    {parameter.in}
                    {parameter.required ? ` · ${labels.required}` : ''}
                  </div>
                </td>
                <td className="py-2 pe-4 font-mono text-[12px] text-ink-soft" dir="ltr">
                  {typeLabel(parameter.schema)}
                </td>
                <td className="py-2 text-[13px] leading-relaxed text-ink-soft">
                  {parameter.description && <Inline text={parameter.description} />}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {body && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[14px] font-semibold">
            {labels.body} <SchemaLink schema={body} />
          </h3>
          <FieldTable doc={doc} schema={body} requiredLabel={labels.required} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold">{labels.responses}</h3>
        <ul className="flex flex-col gap-1.5">
          {Object.entries(operation.responses ?? {}).map(([status, response]) => {
            const schema = response.content?.['application/json']?.schema;
            return (
              <li key={status} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                <code className={`font-mono font-semibold ${status.startsWith('2') ? 'text-done-fg' : 'text-blocked-fg'}`}>{status}</code>
                <span className="text-ink-soft">
                  <Inline text={response.description ?? ''} />
                </span>
                {schema && <SchemaLink schema={schema} />}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function SchemaLink({ schema }: { schema: JsonSchema }) {
  const label = typeLabel(schema);
  const name = schema.$ref?.split('/').pop();
  return name ? (
    <a href={`#schema-${name}`} className="font-mono text-[12.5px] font-medium text-accent hover:underline" dir="ltr">
      {label}
    </a>
  ) : (
    <code className="font-mono text-[12.5px] text-ink-muted" dir="ltr">
      {label}
    </code>
  );
}

function FieldTable({ doc, schema, requiredLabel }: { doc: OpenApiDocument; schema: JsonSchema; requiredLabel: string }) {
  const fields = fieldsOf(doc, schema);
  if (fields.length === 0) return null;
  return (
    <Table>
      {fields.map((field) => (
        <tr key={field.name} className="align-top">
          <td className="py-2 pe-4">
            <code className="font-mono text-[12.5px] font-semibold" dir="ltr">
              {field.name}
            </code>
            {field.required && <div className="text-[11.5px] text-ink-muted">{requiredLabel}</div>}
          </td>
          <td className="py-2 pe-4 font-mono text-[12px] text-ink-soft" dir="ltr">
            {field.type}
          </td>
          <td className="py-2 text-[13px] leading-relaxed text-ink-soft">
            {field.description && <Inline text={field.description} />}
            {field.values && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {field.values.map((value) => (
                  <code key={value} className="rounded bg-raised px-1 font-mono text-[11.5px]" dir="ltr">
                    {value}
                  </code>
                ))}
              </div>
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface px-3">
      <table className="w-full min-w-[520px] text-start">
        <tbody className="divide-y divide-line-soft">{children}</tbody>
      </table>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <>
      {markdownBlocks(text).map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <h2 key={index} className="mt-4 text-[18px] font-semibold">
                {block.text}
              </h2>
            );
          case 'code':
            return (
              <pre key={index} className="overflow-x-auto rounded-card border border-line bg-raised p-3 font-mono text-[12.5px]" dir="ltr">
                {block.text}
              </pre>
            );
          case 'list':
            return (
              <ul key={index} className="flex list-disc flex-col gap-1 ps-5 text-[14px] leading-relaxed text-ink-soft">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          default:
            return (
              <p key={index} className="max-w-3xl text-[14px] leading-relaxed text-ink-soft">
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((part, index) =>
        part.kind === 'code' ? (
          <code key={index} className="rounded bg-raised px-1 py-0.5 font-mono text-[0.92em]" dir="ltr">
            {part.text}
          </code>
        ) : part.kind === 'strong' ? (
          <strong key={index} className="font-semibold text-ink">
            {part.text}
          </strong>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
