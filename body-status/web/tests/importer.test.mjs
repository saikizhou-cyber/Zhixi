import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseHealthFile, crc32, LIMITS } from '../importer.mjs';
import { demoData } from '../demo.mjs';
import { journalEntry } from '../model.mjs';

const startDate = '2026-11-15 08:00:00 +0800', endDate = '2026-11-15 08:00:01 +0800';
const attrs = (type, value, unit = 'count/min', extra = '') => `type="${type}" value="${value}" unit="${unit}" sourceName="Apple Watch" startDate="${startDate}" endDate="${endDate}" ${extra}`;
const record = (type = 'HKQuantityTypeIdentifierHeartRate', value = 62, unit, extra) => `<Record ${attrs(type, value, unit, extra)}/>`;
const xml = contents => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE HealthData [<!ELEMENT HealthData (Record*)><!ELEMENT Record EMPTY>]><HealthData locale="zh_CN">${contents}</HealthData>`;
const file = (contents, name = 'export.xml') => new File([contents], name);
const parse = contents => parseHealthFile(file(xml(contents)));
const sample = () => ({ id: 'untrusted-id', type: 'hrv', value: 42, start: 1794690000000, end: 1794690000000, unit: 'ms', source: 'Watch' });
const backup = (records = [sample()], journal = []) => file(JSON.stringify({ schemaVersion: 1, records, journal }), 'backup.json');

function zip(contents, { method = 8, name = 'apple_health_export/export.xml', crc = null, encrypted = false, size = null, descriptor = false } = {}) {
  const bytes = Buffer.from(contents), compressed = method === 8 ? deflateRawSync(bytes) : bytes, nameBytes = Buffer.from(name);
  const checksum = crc ?? crc32(bytes), flags = (encrypted ? 1 : 0) | (descriptor ? 8 : 0);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(size ?? bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  const dataDescriptor = Buffer.alloc(descriptor ? 16 : 0);
  if (descriptor) {
    local.fill(0, 14, 26);
    dataDescriptor.writeUInt32LE(0x08074b50, 0); dataDescriptor.writeUInt32LE(checksum, 4);
    dataDescriptor.writeUInt32LE(compressed.length, 8); dataDescriptor.writeUInt32LE(size ?? bytes.length, 12);
  }
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(method, 10); directory.writeUInt32LE(checksum, 16);
  directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(size ?? bytes.length, 24); directory.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length + nameBytes.length, 12); end.writeUInt32LE(local.length + nameBytes.length + compressed.length + dataDescriptor.length, 16);
  return file(Buffer.concat([local, nameBytes, compressed, dataDescriptor, directory, nameBytes, end]), 'export.zip');
}

test('Apple XML: supported quantities, sleep, workouts, entities, duplicate and manual metadata', async () => {
  const heart = record();
  const result = await parse([
    heart, heart,
    record('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', '.052', 's'),
    record('HKQuantityTypeIdentifierOxygenSaturation', '.97', '%'),
    record('HKQuantityTypeIdentifierOxygenSaturation', '98', '%'),
    record('HKQuantityTypeIdentifierActiveEnergyBurned', '418.4', 'kJ'),
    record('HKQuantityTypeIdentifierStepCount', '0', 'count'),
    record('HKCategoryTypeIdentifierSleepAnalysis', 'HKCategoryValueSleepAnalysisAsleepDeep', ''),
    `<Record ${attrs('HKQuantityTypeIdentifierHeartRate', '85')}><MetadataEntry key="HKWasUserEntered" value="1"/></Record>`,
    record('UnsupportedMetric', '100'),
    `<Workout workoutActivityType='HKWorkoutActivityTypeWalking' sourceName='A &amp; B &quot;Watch&quot; &#x4e2d;' startDate='${startDate}' endDate='${endDate}'><WorkoutStatistics type='x'/></Workout>`,
  ].join(''));
  assert.equal(result.stats.total, 11); assert.equal(result.stats.accepted, 8);
  assert.equal(result.stats.duplicates, 1); assert.equal(result.stats.skipped, 2);
  assert.equal(result.records.find(r => r.type === 'hrv').value, 52);
  assert.deepEqual(result.records.filter(r => r.type === 'oxygenSaturation').map(r => r.value), [97, 98]);
  assert.ok(Math.abs(result.records.find(r => r.type === 'activeEnergy').value - 100) < 1e-10);
  assert.equal(result.records.find(r => r.type === 'sleep').value, 'deep');
  assert.equal(result.records.find(r => r.type === 'workout').source, 'A & B "Watch" 中');
  assert.equal(result.records[0].start, Date.parse('2026-11-15T00:00:00Z'));
  assert.ok(result.warnings.some(w => w.includes('手动')));
});

test('all numeric metric units normalize, missing source is explicit', async () => {
  const result = await parse(record('HKQuantityTypeIdentifierRestingHeartRate', 59) + record('HKQuantityTypeIdentifierRespiratoryRate', 14) + record('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 44, 'ms').replace(' sourceName="Apple Watch"', ''));
  assert.deepEqual(result.records.map(r => r.unit), ['bpm', 'breaths/min', 'ms']);
  assert.equal(result.records[2].source, '未知来源');
});

test('Apple Correlation schema skips duplicated children without blocking the full export', async () => {
  // 结构依据 HealthKit Export DTD：https://gist.github.com/dlo/fa537daf94cb3bb5527bc86ea10dced0
  const pressure = `<Correlation type="HKCorrelationTypeIdentifierBloodPressure" sourceName="Monitor" startDate="${startDate}" endDate="${endDate}"><MetadataEntry key="HKWasUserEntered" value="1"/>${record('HKQuantityTypeIdentifierBloodPressureSystolic', 120, 'mmHg')}${record('HKQuantityTypeIdentifierBloodPressureDiastolic', 80, 'mmHg')}</Correlation>`;
  const food = `<Correlation type="HKCorrelationTypeIdentifierFood" sourceName="Food" startDate="${startDate}" endDate="${endDate}">${record('HKQuantityTypeIdentifierDietaryEnergyConsumed', 400, 'kcal')}</Correlation>`;
  const input = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE HealthData [
    <!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary)*)>
    <!ELEMENT Correlation ((MetadataEntry|Record)*)>
    <!ELEMENT Record (MetadataEntry*)>
  ]><HealthData locale="zh_CN"><ExportDate value="${endDate}"/><Me/>${record()}${pressure}${food}${record('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 45, 'ms')}</HealthData>`;
  const result = await parseHealthFile(file(input));
  assert.equal(result.stats.total, 5); assert.equal(result.stats.accepted, 2); assert.equal(result.stats.skipped, 3);
  assert.deepEqual(result.records.map(r => r.type), ['heartRate', 'hrv']);
  assert.ok(result.warnings.some(w => w.includes('Correlation') && w.endsWith('3 条')));
});

test('only direct Correlation child records are tolerated; arbitrary record nesting is rejected', async () => {
  assert.equal((await parse(`<Correlation>${record()}</Correlation>${record()}`)).records.length, 1);
  for (const contents of [`<Wrapper>${record()}</Wrapper>`, `<Correlation><Wrapper>${record()}</Wrapper></Correlation>`, `<Correlation><Correlation/></Correlation>`, `<Record ${attrs('HKQuantityTypeIdentifierHeartRate', 62)}>${record()}</Record>`, `<Correlation><Workout/></Correlation>`, `<Wrapper><Correlation/></Wrapper>`]) await assert.rejects(parse(contents), /结构|Correlation/);
});

test('invalid units, values and dates are skipped explicitly instead of producing zero', async () => {
  const bad = [record('HKQuantityTypeIdentifierHeartRate', -1), record('HKQuantityTypeIdentifierHeartRate', 0), record('HKQuantityTypeIdentifierHeartRate', 'Infinity'), record('HKQuantityTypeIdentifierHeartRate', ''), record('HKQuantityTypeIdentifierHeartRate', '65', 'kg'), record('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 35, 'kg'), record('HKQuantityTypeIdentifierOxygenSaturation', '101', '%'), record().replace(startDate, '2026-11-15 08:00:00'), record().replace(startDate, '2026-02-30 08:00:00 +0800'), record().replace(startDate, '2026-11-15 08:00:00 +1460')];
  const result = await parse(bad.join('') + record());
  assert.equal(result.stats.skipped, bad.length); assert.equal(result.records.length, 1);
  assert.ok(result.warnings.length >= 4);
});

test('sleep aliases and zero energy valid; zero-length sleep excluded', async () => {
  const result = await parse(record('HKCategoryTypeIdentifierSleepAnalysis', '4', '') + record('HKQuantityTypeIdentifierActiveEnergyBurned', '0', 'kcal') + record('HKCategoryTypeIdentifierSleepAnalysis', '4', '').replace(endDate, startDate));
  assert.equal(result.records[0].value, 'deep'); assert.equal(result.records[1].value, 0); assert.equal(result.stats.skipped, 1);
});

test('chunked XML parses split UTF-8 characters and quotes containing >', async () => {
  const encoded = new TextEncoder().encode(xml(record().replace('Apple Watch', '手表 &gt; Watch')));
  const chunks = { name: 'export.xml', size: encoded.length, stream: () => new ReadableStream({ start(controller) { for (const byte of encoded) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }) };
  const result = await parseHealthFile(chunks);
  assert.equal(result.records[0].source, '手表 > Watch');
});

test('malformed and truncated XML fail atomically', async () => {
  for (const malformed of [xml(record()).replace('</HealthData>', ''), xml(record()).replace('</HealthData>', '</Other>'), '<other/>', xml(record()).replace('value="62"', 'value="62" value="72"'), xml(record()).replace('Apple Watch', '&fake;'), xml(record()) + '<HealthData/>', xml(record()) + 'unexpected', '<HealthData><Record']) await assert.rejects(parseHealthFile(file(malformed)));
});

test('custom or external entities and excessive XML nesting are rejected', async () => {
  await assert.rejects(parseHealthFile(file('<!DOCTYPE HealthData [<!ENTITY bomb "expand">]><HealthData/>')), /实体/);
  await assert.rejects(parseHealthFile(file('<!DOCTYPE HealthData SYSTEM "https://example.com/evil.dtd"><HealthData/>')), /实体/);
  await assert.rejects(parseHealthFile(file(`<HealthData>${'<x>'.repeat(66)}${'</x>'.repeat(66)}</HealthData>`)), /层级/);
});

test('JSON backup validates, strips extra fields and recomputes stable IDs', async () => {
  const log = { id: 'mood-1', kind: 'mood', value: 4, note: '休息得不错', at: 1794690000000 };
  const result = await parseHealthFile(backup([{ ...sample(), unsafe: '<script/>' }, sample()], [log]));
  assert.equal(result.records.length, 1); assert.equal(result.stats.duplicates, 1);
  assert.equal(result.records[0].id, JSON.stringify(['hrv', 'Watch', sample().start, sample().end, 42, 'ms']));
  assert.equal(result.records[0].unsafe, undefined); assert.deepEqual(result.journal, [log]);
});

test('JSON schema, numbers, source, units, dates and journal trust boundaries', async () => {
  await assert.rejects(parseHealthFile(file('{', 'b.json')), /JSON/);
  await assert.rejects(parseHealthFile(file('{"schemaVersion":2,"records":[],"journal":[]}', 'b.json')), /schemaVersion/);
  for (const changes of [{ value: '42' }, { value: null }, { type: '__proto__' }, { source: '' }, { unit: 's' }, { end: 0 }, { start: -1 }, { source: 'A'.repeat(1025) }]) await assert.rejects(parseHealthFile(backup([{ ...sample(), ...changes }])));
  const log = { id: 'a', kind: 'mood', value: 3, at: 1794690000000, note: '' };
  for (const changes of [{ value: 6 }, { value: 0 }, { kind: 'water', value: 10001 }, { kind: 'caffeine', value: -1 }, { kind: 'caffeine', value: 2001 }, { kind: 'note', value: '' }, { note: 'A'.repeat(2001) }, { at: '2026-11-15' }, { at: Date.now() + 120000 }]) await assert.rejects(parseHealthFile(backup([], [{ ...log, ...changes }])));
  await assert.rejects(parseHealthFile(backup([], [log, log])), /重复/);
});

test('all journal kinds round trip', async () => {
  const journal = ['mood', 'water', 'caffeine', 'note'].map((kind, i) => ({ id: String(i), kind, value: [4, 250, 60, '午后散步'][i], at: 1794690000000, note: '' }));
  assert.deepEqual((await parseHealthFile(backup([], journal))).journal, journal);
});

test('application demo and manually entered journal export round trip', async () => {
  const now = Date.now(), data = demoData(now);
  const journal = [
    ...data.journal,
    journalEntry({ kind: 'water', value: '10000', note: '', at: new Date(now).toISOString() }, now),
    journalEntry({ kind: 'caffeine', value: '0', note: '无咖啡因', at: new Date(now).toISOString() }, now),
    journalEntry({ kind: 'caffeine', value: '2000', note: '', at: new Date(now).toISOString() }, now),
    journalEntry({ kind: 'note', value: '', note: '散步记录', at: new Date(now).toISOString() }, now),
  ];
  const imported = await parseHealthFile(backup(data.records, journal));
  assert.deepEqual(imported.records, data.records);
  assert.deepEqual(imported.journal, journal);
});

test('stored and deflate ZIP produce the same parsed records', async () => {
  const expected = await parse(record());
  for (const method of [0, 8]) assert.deepEqual((await parseHealthFile(zip(xml(record()), { method }))).records, expected.records);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZIP data-descriptor flag uses central directory sizes and verifies actual CRC', async () => {
  assert.equal((await parseHealthFile(zip(xml(record()), { descriptor: true }))).records.length, 1);
  await assert.rejects(parseHealthFile(zip(xml(record()), { descriptor: true, crc: 1 })), /校验/);
});

test('ZIP CRC, size, encryption, unsupported methods and missing target reject', async () => {
  await assert.rejects(parseHealthFile(zip(xml(record()), { crc: 1 })), /校验/);
  await assert.rejects(parseHealthFile(zip(xml(record()), { size: 1 })), /大小/);
  await assert.rejects(parseHealthFile(zip(xml(record()), { encrypted: true })), /加密/);
  await assert.rejects(parseHealthFile(zip(xml(record()), { method: 99 })), /算法/);
  await assert.rejects(parseHealthFile(zip(xml(record()), { name: 'not-health.xml' })), /没有/);
  await assert.rejects(parseHealthFile(zip(xml(record()), { name: '../export.xml' })), /路径/);
  await assert.rejects(parseHealthFile(zip(xml(record()), { size: LIMITS.xmlBytes + 1 })), /过大/);
});

test('ZIP malformed offsets and ZIP64 reject without out-of-bounds access', async () => {
  const bytes = new Uint8Array(await zip(xml(record())).arrayBuffer()), view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 6, 0xfffffffe, true);
  await assert.rejects(parseHealthFile(file(bytes, 'bad.zip')), /边界/);
  view.setUint32(bytes.length - 6, 0xffffffff, true);
  await assert.rejects(parseHealthFile(file(bytes, 'bad.zip')), /ZIP64/);
  await assert.rejects(parseHealthFile(file(bytes.slice(0, -20), 'bad.zip')), /目录/);
});

test('file limits, extensions and progress are explicit', async () => {
  await assert.rejects(parseHealthFile(file('', 'empty.xml')), /非空/);
  await assert.rejects(parseHealthFile(file('not supported', 'health.csv')), /支持/);
  await assert.rejects(parseHealthFile({ name: 'a.xml', size: LIMITS.fileBytes + 1, stream() {} }), /200 MB/);
  const progress = [];
  await parseHealthFile(file(xml(record())), { onProgress: p => progress.push(p.percent) });
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 100); assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]));
});

test('JSON record and journal capacity limits fail before item processing', async () => {
  await assert.rejects(parseHealthFile(backup(Array(LIMITS.records + 1).fill(null))), /数量/);
  await assert.rejects(parseHealthFile(backup([], Array(LIMITS.journal + 1).fill(null))), /数量/);
});
