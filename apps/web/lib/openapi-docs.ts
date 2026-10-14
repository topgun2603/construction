/**
 * Just enough OpenAPI 3.1 reading to render the public API reference (`/developers/docs`) as plain
 * server-rendered HTML — no third-party viewer, no script from a CDN, nothing for a content
 * security policy to allow. The document is the API's own (`/public/v1/openapi.json`), so only the
 * shapes it uses are handled: `$ref`, `oneOf` with null, `allOf`, arrays, enums, objects.
 */

export type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  example?: unknown;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
};

export interface OpenApiParameter {
  $ref?: string;
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  'x-required-scope'?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: JsonSchema }> }>;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    parameters?: Record<string, OpenApiParameter>;
    schemas?: Record<string, JsonSchema>;
  };
}

export interface OperationEntry {
  method: string;
  path: string;
  operation: OpenApiOperation;
  /** A stable anchor for linking to it. */
  anchor: string;
}

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'];

/** Every operation, in document order of paths and GET before POST within a path. */
export function operationsOf(doc: OpenApiDocument): OperationEntry[] {
  return Object.entries(doc.paths).flatMap(([path, operations]) =>
    Object.entries(operations)
      .sort(([a], [b]) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b))
      .map(([method, operation]) => ({
        method,
        path,
        operation,
        anchor: operation.operationId ?? `${method}-${path.replace(/[^a-z0-9]+/gi, '-')}`,
      })),
  );
}

/** The name a `$ref` points at: `#/components/schemas/Expense` → `Expense`. */
export function refName(ref: string): string {
  return ref.split('/').pop() ?? ref;
}

export function resolveParameter(doc: OpenApiDocument, parameter: OpenApiParameter): OpenApiParameter {
  if (!parameter.$ref) return parameter;
  return doc.components?.parameters?.[refName(parameter.$ref)] ?? parameter;
}

export function resolveSchema(doc: OpenApiDocument, schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema?.$ref) return schema;
  return doc.components?.schemas?.[refName(schema.$ref)];
}

/** A one-line type: `string (uuid)`, `integer`, `Expense`, `array of Expense`, `string or null`. */
export function typeLabel(schema: JsonSchema | undefined): string {
  if (!schema) return 'any';
  if (schema.$ref) return refName(schema.$ref);
  if (schema.oneOf) return schema.oneOf.map(typeLabel).join(' or ');
  if (schema.allOf) return schema.allOf.map(typeLabel).join(' + ');
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const type = Array.isArray(schema.type) ? schema.type.join(' or ') : (schema.type ?? 'object');
  if (type === 'array') return `array of ${typeLabel(schema.items)}`;
  return schema.format ? `${type} (${schema.format})` : type;
}

export interface FieldRow {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
  values: string[] | null;
}

/** The properties of an object schema — following `$ref` and `allOf` — as table rows. */
export function fieldsOf(doc: OpenApiDocument, schema: JsonSchema | undefined): FieldRow[] {
  const resolved = resolveSchema(doc, schema);
  if (!resolved) return [];
  if (resolved.allOf) return resolved.allOf.flatMap((part) => fieldsOf(doc, part));
  const required = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties ?? {}).map(([name, property]) => {
    const inner = property.oneOf?.find((option) => option.type !== 'null') ?? property;
    const values = (inner.enum ?? property.enum)?.map(String) ?? null;
    return {
      name,
      type: typeLabel(property),
      required: required.has(name),
      description: property.description ?? inner.description ?? null,
      values,
    };
  });
}

/** The schemas a type mentions by name, for linking to them. */
export function referencedSchemas(schema: JsonSchema | undefined): string[] {
  if (!schema) return [];
  if (schema.$ref) return [refName(schema.$ref)];
  return [
    ...(schema.oneOf ?? []).flatMap(referencedSchemas),
    ...(schema.allOf ?? []).flatMap(referencedSchemas),
    ...referencedSchemas(schema.items),
  ];
}

// --- the description's Markdown ---------------------------------------------------------------------

export type DocBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; text: string };

/**
 * The small Markdown subset the API's description is written in: `## ` headings, `- ` lists
 * (with indented continuation lines), four-space code blocks and paragraphs. Text stays text — it
 * is rendered by React, never as HTML.
 */
export function markdownBlocks(markdown: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    if (line.startsWith('## ') || line.startsWith('# ')) {
      blocks.push({ kind: 'heading', text: line.replace(/^#+\s*/, '') });
      index += 1;
      continue;
    }
    if (line.startsWith('    ')) {
      const code: string[] = [];
      while (index < lines.length && (lines[index]!.startsWith('    ') || lines[index]!.trim() === '')) {
        code.push(lines[index]!.slice(4));
        index += 1;
      }
      blocks.push({ kind: 'code', text: code.join('\n').trimEnd() });
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (index < lines.length && (lines[index]!.startsWith('- ') || lines[index]!.startsWith('  '))) {
        const current = lines[index]!;
        if (current.startsWith('- ')) items.push(current.slice(2).trim());
        else items[items.length - 1] = `${items[items.length - 1] ?? ''} ${current.trim()}`;
        index += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() !== '' && !/^(#|- | {4})/.test(lines[index]!)) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

export type InlinePart = { kind: 'text' | 'code' | 'strong'; text: string };

/** `code` and **bold** inside a line. */
export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) parts.push({ kind: 'text', text: text.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ kind: 'code', text: match[1] });
    else parts.push({ kind: 'strong', text: match[2]! });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** Where the web server finds the API's public document: API_URL without its `/v1`. */
export function openApiUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/public/v1/openapi.json`;
}
