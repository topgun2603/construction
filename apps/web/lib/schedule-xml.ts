/**
 * Getting a schedule file under the server-action body limit.
 *
 * A Next server action takes at most 1 MB. A real MS Project or P6 export can be several times that,
 * and most of it is what the importer never reads: resources, assignments, timephased data, custom
 * fields, notes. Those are dropped in the browser before the file is sent; the tasks, links and
 * calendars that make the schedule are left exactly as they were.
 */

/** Files at or under this are sent as they are. */
export const SCHEDULE_XML_TRIM_BYTES = 900_000;
/** What a server action will accept. */
export const SCHEDULE_XML_MAX_BYTES = 1_000_000;

/** Elements, by local name, that neither importer reads. */
const DROP_EXACT = new Set([
  // MS Project
  'Resources',
  'Assignments',
  'TimephasedData',
  'ExtendedAttribute',
  'ExtendedAttributes',
  'Baseline',
  'OutlineCodes',
  'WBSMasks',
  // Primavera P6
  'Resource',
  'ResourceAssignment',
  'ResourceRate',
  'ActivityNote',
  'ActivityExpense',
  'ActivityStep',
]);
const DROP_PREFIXES = ['ActivityCode', 'UDF'];

function droppable(localName: string): boolean {
  return DROP_EXACT.has(localName) || DROP_PREFIXES.some((prefix) => localName.startsWith(prefix));
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export interface TrimmedScheduleXml {
  xml: string;
  /** Size in bytes of what will be sent. */
  bytes: number;
  /** Size before trimming. */
  originalBytes: number;
  /** Whether anything was taken out. */
  trimmed: boolean;
  /** Still too big to send, even trimmed. */
  tooLarge: boolean;
}

/**
 * Trim a schedule file if it is over `trimAt` bytes. A file the browser cannot parse is returned
 * untouched, so the server's importer gets to say what is wrong with it.
 */
export function trimScheduleXml(
  xml: string,
  { trimAt = SCHEDULE_XML_TRIM_BYTES, max = SCHEDULE_XML_MAX_BYTES } = {},
): TrimmedScheduleXml {
  const originalBytes = utf8Bytes(xml);
  const result = (out: string, trimmed: boolean): TrimmedScheduleXml => {
    const bytes = trimmed ? utf8Bytes(out) : originalBytes;
    return { xml: out, bytes, originalBytes, trimmed, tooLarge: bytes > max };
  };
  if (originalBytes <= trimAt) return result(xml, false);

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return result(xml, false);

  // Collected first: removing while walking a live collection skips elements.
  const doomed: Element[] = [];
  const walk = (element: Element) => {
    for (const child of Array.from(element.children)) {
      if (droppable(child.localName)) doomed.push(child);
      else walk(child);
    }
  };
  if (doc.documentElement) walk(doc.documentElement);
  for (const element of doomed) element.remove();

  // Indentation is a good share of a pretty-printed export, and neither format reads it.
  const blanks: Node[] = [];
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim()) blanks.push(node);
  }
  for (const node of blanks) node.parentNode?.removeChild(node);

  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith('<?xml')) out = `<?xml version="1.0" encoding="UTF-8"?>${out}`;
  return result(out, true);
}
