import { describe, expect, it } from 'vitest';
import {
  fieldsOf,
  inlineParts,
  markdownBlocks,
  openApiUrl,
  operationsOf,
  typeLabel,
  type OpenApiDocument,
} from './openapi-docs';

const doc: OpenApiDocument = {
  openapi: '3.1.0',
  info: { title: 't', version: 'v1' },
  paths: {
    '/expenses': {
      post: { operationId: 'createExpense', summary: 'Record' },
      get: { operationId: 'listExpenses', summary: 'List' },
    },
  },
  components: {
    schemas: {
      Expense: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          amount: { type: 'integer', description: 'Minor units.' },
          note: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          status: { type: 'string', enum: ['pending', 'approved'] },
        },
        required: ['id', 'amount'],
      },
      Detail: { allOf: [{ $ref: '#/components/schemas/Expense' }, { type: 'object', properties: { lines: { type: 'array', items: { $ref: '#/components/schemas/Line' } } } }] },
    },
  },
};

describe('the API reference renderer', () => {
  it('lists operations GET first within a path', () => {
    expect(operationsOf(doc).map((entry) => `${entry.method} ${entry.anchor}`)).toEqual(['get listExpenses', 'post createExpense']);
  });

  it('labels types, following refs, nullables and arrays', () => {
    expect(typeLabel({ type: 'string', format: 'uuid' })).toBe('string (uuid)');
    expect(typeLabel({ oneOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string or null');
    expect(typeLabel({ type: 'array', items: { $ref: '#/components/schemas/Expense' } })).toBe('array of Expense');
  });

  it('reads an object’s fields through $ref and allOf', () => {
    const fields = fieldsOf(doc, { $ref: '#/components/schemas/Detail' });
    expect(fields.map((field) => field.name)).toEqual(['id', 'amount', 'note', 'status', 'lines']);
    expect(fields.find((field) => field.name === 'amount')).toMatchObject({ required: true, description: 'Minor units.' });
    expect(fields.find((field) => field.name === 'status')?.values).toEqual(['pending', 'approved']);
  });

  it('reads the description’s Markdown as blocks, never as HTML', () => {
    const blocks = markdownBlocks('Intro line\nmore.\n\n## Auth\n\n    Authorization: Bearer x\n\n- one\n  continued\n- two <b>');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Intro line more.' },
      { kind: 'heading', text: 'Auth' },
      { kind: 'code', text: 'Authorization: Bearer x' },
      { kind: 'list', items: ['one continued', 'two <b>'] },
    ]);
    expect(inlineParts('Use `bk_live_` keys, **always**.')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'code', text: 'bk_live_' },
      { kind: 'text', text: ' keys, ' },
      { kind: 'strong', text: 'always' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('finds the document beside the API', () => {
    expect(openApiUrl('http://localhost:3000/v1')).toBe('http://localhost:3000/public/v1/openapi.json');
    expect(openApiUrl('https://api.buildr.app/v1/')).toBe('https://api.buildr.app/public/v1/openapi.json');
  });
});
