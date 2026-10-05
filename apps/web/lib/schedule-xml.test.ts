import { describe, expect, it } from 'vitest';
import { trimScheduleXml, utf8Bytes } from './schedule-xml';

const msProject = (padding: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Villa</Name>
  <Calendars><Calendar><UID>1</UID><Name>Standard</Name></Calendar></Calendars>
  <Tasks>
    <Task>
      <UID>1</UID><Name>Footings</Name><Duration>PT24H0M0S</Duration>
      <ExtendedAttribute><FieldID>1</FieldID><Value>${padding}</Value></ExtendedAttribute>
      <Baseline><Number>0</Number></Baseline>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type></PredecessorLink>
    </Task>
  </Tasks>
  <Resources><Resource><UID>1</UID><Name>${padding}</Name></Resource></Resources>
  <Assignments><Assignment><TimephasedData>${padding}</TimephasedData></Assignment></Assignments>
</Project>`;

const p6 = (padding: string) => `<?xml version="1.0" encoding="UTF-8"?>
<APIBusinessObjects>
  <Project>
    <Name>Tower</Name>
    <Activity><Id>A100</Id><Name>Piling</Name></Activity>
    <Relationship><PredecessorActivityObjectId>1</PredecessorActivityObjectId></Relationship>
    <ActivityCodeAssignment>${padding}</ActivityCodeAssignment>
    <UDFValue>${padding}</UDFValue>
    <ResourceAssignment>${padding}</ResourceAssignment>
    <ActivityNote>${padding}</ActivityNote>
  </Project>
  <Resource><Name>${padding}</Name></Resource>
</APIBusinessObjects>`;

describe('trimScheduleXml', () => {
  it('leaves a small file exactly as it was', () => {
    const xml = msProject('x');
    const out = trimScheduleXml(xml);
    expect(out.trimmed).toBe(false);
    expect(out.xml).toBe(xml);
    expect(out.tooLarge).toBe(false);
  });

  it('drops what the MS Project importer never reads and keeps tasks, links and calendars', () => {
    const xml = msProject('y'.repeat(2000));
    const out = trimScheduleXml(xml, { trimAt: 1000, max: 5000 });
    expect(out.trimmed).toBe(true);
    expect(out.bytes).toBeLessThan(out.originalBytes);
    expect(out.tooLarge).toBe(false);
    for (const gone of ['<Resources', '<Assignments', '<ExtendedAttribute', '<Baseline', 'TimephasedData']) {
      expect(out.xml).not.toContain(gone);
    }
    for (const kept of ['<Calendar>', '<Name>Footings</Name>', '<PredecessorLink>', '<Duration>']) {
      expect(out.xml).toContain(kept);
    }
    expect(out.xml.startsWith('<?xml')).toBe(true);
  });

  it('drops P6 resources, codes, UDFs and notes', () => {
    const out = trimScheduleXml(p6('z'.repeat(2000)), { trimAt: 1000, max: 5000 });
    expect(out.trimmed).toBe(true);
    for (const gone of ['ActivityCodeAssignment', 'UDFValue', 'ResourceAssignment', 'ActivityNote', '<Resource>']) {
      expect(out.xml).not.toContain(gone);
    }
    expect(out.xml).toContain('<Activity>');
    expect(out.xml).toContain('<Relationship>');
  });

  it('says when a file is still too large after trimming', () => {
    const big = `<Project><Tasks><Task><Name>${'n'.repeat(3000)}</Name></Task></Tasks></Project>`;
    const out = trimScheduleXml(big, { trimAt: 1000, max: 2000 });
    expect(out.tooLarge).toBe(true);
  });

  it('hands an unreadable file to the server untouched', () => {
    const broken = `<Project><Task>${'b'.repeat(2000)}`;
    const out = trimScheduleXml(broken, { trimAt: 1000, max: 5000 });
    expect(out.trimmed).toBe(false);
    expect(out.xml).toBe(broken);
  });

  it('counts bytes, not characters', () => {
    expect(utf8Bytes('مشروع')).toBe(10);
  });
});
