import { XMLParser } from 'fast-xml-parser';
import type { ScheduleImportFormat } from '@sitebook/shared';
import { ScheduleImportError, type ScheduleImportPlan } from './import-plan';
import { parseMsProject } from './msproject';
import { parseP6 } from './p6';

/**
 * Reads a Microsoft Project XML or Primavera P6 XML file into an import plan.
 *
 * Why a library: both formats are large, namespaced, entity-escaped XML written by tools we do not
 * control, and a hand-rolled reader is how an import breaks on the first file with a CDATA note in
 * it. `fast-xml-parser` is small, has no dependencies of its own worth mentioning, was already in
 * the lockfile under the AWS SDK, and never fetches external entities.
 */

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  // Everything stays text: a WBS code of "1.10" must not become the number 1.1.
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false,
});

export function parseScheduleXml(xml: string, format: ScheduleImportFormat = 'auto'): ScheduleImportPlan {
  // Neither tool writes a document type; one that arrives with entity declarations is either
  // something else or an attempt to expand a few bytes into gigabytes.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new ScheduleImportError('That file declares a document type, which schedule exports never do.');
  }
  let document: Record<string, unknown>;
  try {
    document = parser.parse(xml, true) as Record<string, unknown>;
  } catch (error) {
    throw new ScheduleImportError(
      `That file is not readable XML${error instanceof Error ? `: ${error.message}` : ''}`,
    );
  }

  const msp = document['Project'] as Record<string, unknown> | undefined;
  const p6 = document['APIBusinessObjects'] as Record<string, unknown> | undefined;
  const detected: 'msproject' | 'p6' | null = p6 ? 'p6' : msp && typeof msp === 'object' ? 'msproject' : null;

  if (!detected) {
    throw new ScheduleImportError(
      'That file is neither a Microsoft Project XML nor a Primavera P6 XML export. Save it from the planning tool as XML and try again.',
    );
  }
  if (format !== 'auto' && format !== detected) {
    throw new ScheduleImportError(
      `That file is a ${detected === 'p6' ? 'Primavera P6' : 'Microsoft Project'} export, not the format chosen.`,
    );
  }
  const plan = detected === 'p6' ? parseP6(p6!) : parseMsProject(msp!);
  if (plan.tasks.length === 0) {
    throw new ScheduleImportError('That file has no tasks in it.');
  }
  return plan;
}
