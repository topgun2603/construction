import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The gateway is the only door to the model vendor (see `AiGateway`), and this keeps it that way.
 *
 * A future feature that imports the SDK and makes its own client would skip the company's off
 * switch, the operator's kill switch, the region and the usage counter all at once — and nothing
 * would look wrong until a company that had turned AI off found its data in a vendor's logs. So the
 * source tree is scanned: the vendor SDK may be imported in exactly one file.
 */
const SRC = join(__dirname, '..', '..');
const ALLOWED = new Set([join('modules', 'ai', 'ai-gateway.service.ts')]);

/** Every vendor SDK this product could reach a model through. Add one here when it is adopted. */
const VENDOR_IMPORT = /from\s+['"](openai|@anthropic-ai\/sdk|@google\/generative-ai|@google-cloud\/translate)(\/[^'"]*)?['"]|require\(\s*['"]openai['"]\s*\)/;
const CLIENT_CONSTRUCTION = /new\s+OpenAI\s*\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('AI gateway is the only way to a model', () => {
  const files = sourceFiles(SRC);

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => relative(SRC, file) === [...ALLOWED][0])).toBe(true);
  });

  it('imports a model vendor SDK nowhere but the gateway', () => {
    const offenders = files
      .filter((file) => !ALLOWED.has(relative(SRC, file)))
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return VENDOR_IMPORT.test(text) || CLIENT_CONSTRUCTION.test(text);
      })
      .map((file) => relative(SRC, file).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });
});
