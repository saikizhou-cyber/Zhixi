export const LIMITS = Object.freeze({ fileBytes: 200 * 1024 * 1024, xmlBytes: 512 * 1024 * 1024, records: 250000, journal: 10000 });

const metricTypes = {
  HKQuantityTypeIdentifierHeartRate: 'heartRate',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'hrv',
  HKQuantityTypeIdentifierRestingHeartRate: 'restingHeartRate',
  HKCategoryTypeIdentifierSleepAnalysis: 'sleep',
  HKQuantityTypeIdentifierStepCount: 'steps',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'activeEnergy',
  HKQuantityTypeIdentifierRespiratoryRate: 'respiratoryRate',
  HKQuantityTypeIdentifierOxygenSaturation: 'oxygenSaturation',
};
export const RECORD_UNITS = Object.freeze({ heartRate: 'bpm', hrv: 'ms', restingHeartRate: 'bpm', sleep: '', steps: 'count', activeEnergy: 'kcal', respiratoryRate: 'breaths/min', oxygenSaturation: '%', workout: '' });
const units = RECORD_UNITS;
const sleepValues = { HKCategoryValueSleepAnalysisAsleep: 'asleep', HKCategoryValueSleepAnalysisAsleepUnspecified: 'asleep', HKCategoryValueSleepAnalysisAsleepCore: 'core', HKCategoryValueSleepAnalysisAsleepDeep: 'deep', HKCategoryValueSleepAnalysisAsleepREM: 'rem', HKCategoryValueSleepAnalysisAwake: 'awake', HKCategoryValueSleepAnalysisInBed: 'inBed', 0: 'inBed', 1: 'asleep', 2: 'awake', 3: 'core', 4: 'deep', 5: 'rem' };
const fail = message => { throw new Error(message); };
const key = r => JSON.stringify([r.type, r.source, r.start, r.end, r.value, r.unit]);
const text = (value, max, label, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim()) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value) ? value : fail(`${label}不合法`);
const timestamp = n => Number.isFinite(n) && n >= 0 && n < Date.UTC(2101, 0, 1);

function date(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?\s*(Z|[+-]\d{2}:?\d{2})$/u);
  if (!match) fail('日期缺少时区或格式不正确');
  const [, y, m, d, h, min, s, ms = '0', zone] = match;
  const local = new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +s, +ms.padEnd(3, '0')));
  if (local.getUTCFullYear() !== +y || local.getUTCMonth() !== +m - 1 || local.getUTCDate() !== +d || +h > 23 || +min > 59 || +s > 59) fail('日期数值不合法');
  let offset = 0;
  if (zone !== 'Z') {
    const z = zone.replace(':', '');
    if (+z.slice(1, 3) > 14 || +z.slice(3) > 59 || (+z.slice(1, 3) === 14 && +z.slice(3) !== 0)) fail('时区偏移不合法');
    offset = (Number(z.slice(1, 3)) * 60 + Number(z.slice(3))) * (z[0] === '+' ? 1 : -1);
  }
  const result = local.getTime() - offset * 60000;
  if (!timestamp(result)) fail('日期超出支持范围');
  return result;
}

function normalizedRecord(input) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(units, input.type)) fail('记录类型不合法');
  const { type, value, start, end, unit } = input;
  if (!timestamp(start) || !timestamp(end) || end < start) fail('记录时间不合法');
  const source = text(input.source, 1024, '来源');
  if (unit !== units[type]) fail('记录单位不合法');
  if (type === 'sleep') {
    if (!Object.values(sleepValues).includes(value) || start === end) fail('睡眠阶段或区间不合法');
  } else if (type === 'workout') {
    text(value, 160, '运动类型');
    if (start === end) fail('运动区间不合法');
  } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (value === 0 && !['steps', 'activeEnergy'].includes(type)) || (type === 'oxygenSaturation' && value > 100)) fail('记录数值不合法');
  const result = { type, value, start, end, unit, source };
  return { id: key(result), ...result };
}

function appleRecord(a, workout) {
  const type = workout ? 'workout' : metricTypes[a.type];
  if (!type) return null;
  let value = a.value;
  if (type === 'sleep') value = sleepValues[value];
  else if (workout) value = a.workoutActivityType;
  else {
    if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(value)) fail('数值格式不合法');
    value = Number(value);
    if (['heartRate', 'restingHeartRate', 'respiratoryRate'].includes(type)) {
      if (!['count/min', 'bpm', 'breaths/min'].includes(a.unit)) fail('心率或呼吸单位不支持');
    } else if (type === 'hrv') {
      if (a.unit === 's') value *= 1000;
      else if (a.unit !== 'ms') fail('HRV 单位不支持');
    } else if (type === 'steps' && a.unit !== 'count') fail('步数单位不支持');
    else if (type === 'activeEnergy') {
      if (a.unit === 'kJ') value /= 4.184;
      else if (a.unit === 'J') value /= 4184;
      else if (a.unit !== 'kcal') fail('能量单位不支持');
    } else if (type === 'oxygenSaturation') {
      if (a.unit !== '%') fail('血氧单位不支持');
      // shortcut: 兼容 Apple 导出的比例值和百分数；若其他来源使用不同约定，需单独适配。
      if (value <= 1) value *= 100;
    }
  }
  return normalizedRecord({ type, value, start: date(a.startDate), end: date(a.endDate), unit: units[type], source: a.sourceName || '未知来源' });
}

function collector(onProgress) {
  const records = [], seen = new Set(), sources = new Set(), types = Object.create(null), reasons = new Map();
  const stats = { total: 0, accepted: 0, skipped: 0, duplicates: 0, sources: [], types };
  return {
    add(record) {
      if (seen.has(record.id)) { stats.duplicates++; return; }
      if (records.length >= LIMITS.records) fail(`记录超过 ${LIMITS.records.toLocaleString()} 条，请缩小导出范围后重试`);
      records.push(record); seen.add(record.id); sources.add(record.source); types[record.type] = (types[record.type] || 0) + 1; stats.accepted++;
    },
    skip(reason) { stats.skipped++; reasons.set(reason, (reasons.get(reason) || 0) + 1); },
    stats,
    finish(journal = []) {
      stats.sources = [...sources].sort();
      onProgress({ percent: 100, message: '解析完成，等待确认导入' });
      return { records, journal, stats, warnings: [...reasons].map(([reason, count]) => `${reason}：${count} 条`) };
    },
  };
}

function entities(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/iu.test(value)) fail('XML 含未知实体');
  return value.replace(/&([^;]+);/gu, (_, entity) => {
    const common = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(common, entity)) return common[entity];
    const n = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) fail('XML 字符实体不合法');
    return String.fromCodePoint(n);
  });
}

function attributes(body) {
  const result = Object.create(null);
  let rest = body;
  while (rest.trim()) {
    const match = rest.match(/^\s+([\w:.-]+)\s*=\s*(["'])([^]*?)\2/u);
    if (!match || Object.hasOwn(result, match[1]) || match[3].includes('<')) fail('XML 属性格式不正确');
    result[match[1]] = entities(match[3]);
    rest = rest.slice(match[0].length);
  }
  return result;
}

function tagEnd(buffer) {
  if (buffer.startsWith('<!--')) { const i = buffer.indexOf('-->'); return i < 0 ? -1 : i + 3; }
  if (buffer.startsWith('<![CDATA[')) { const i = buffer.indexOf(']]>'); return i < 0 ? -1 : i + 3; }
  let quote = '', brackets = 0;
  for (let i = 1; i < buffer.length; i++) {
    const c = buffer[i];
    if (quote) { if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
    else if (c === '>' && brackets === 0) return i + 1;
  }
  return -1;
}

async function parseXML(stream, size, onProgress) {
  const out = collector(onProgress), decoder = new TextDecoder('utf-8', { fatal: true });
  const stack = [];
  let buffer = '', bytes = 0, root = false, rootClosed = false, active = null, lastProgress = -1;
  function token(tag) {
    if (tag.startsWith('<!--') || tag.startsWith('<?')) return;
    if (tag.startsWith('<![CDATA[')) { if (!stack.length) fail('XML 根元素外出现文本'); return; }
    if (tag.startsWith('<!DOCTYPE')) {
      if (root || !/^<!DOCTYPE\s+HealthData(?:\s|\[|>)/u.test(tag) || /<!ENTITY\b|\b(?:SYSTEM|PUBLIC)\s+["']/u.test(tag)) fail('不支持外部实体或自定义实体声明');
      return;
    }
    if (tag.startsWith('</')) {
      const name = tag.match(/^<\/([\w:.-]+)\s*>$/u)?.[1];
      if (!name || stack.pop() !== name) fail('XML 标签不匹配或文件不完整');
      if (active && name === active.name) {
        out.stats.total++;
        if (active.inCorrelation) out.skip('已跳过 Correlation 子记录，使用其顶层记录');
        else if (active.manual) out.skip('已跳过手动录入的数据');
        else {
          try { const r = appleRecord(active.attrs, name === 'Workout'); r ? out.add(r) : out.skip('暂不支持的数据类型'); }
          catch (error) { if (out.stats.accepted >= LIMITS.records) throw error; out.skip(error.message); }
        }
        active = null;
      }
      if (!stack.length) rootClosed = true;
      return;
    }
    const match = tag.match(/^<([\w:.-]+)([^]*?)(\/?)>$/u);
    if (!match) fail('XML 标签格式不正确');
    const [, name, body, self] = match, a = attributes(body);
    if (!stack.length) {
      if (root || name !== 'HealthData') fail('请选择 Apple 健康导出的 HealthData XML');
      root = true;
    }
    if (stack.length > 64) fail('XML 嵌套层级过深');
    if (name === 'Correlation' && stack.length !== 1) fail('Correlation 必须位于 HealthData 下');
    if (stack.at(-1) === 'Correlation' && !['Record', 'MetadataEntry'].includes(name)) fail('Correlation 子元素结构不合法');
    if (name === 'Record' || name === 'Workout') {
      // Apple 导出 DTD 说明 Correlation 子记录也会作为顶层记录出现，避免重复纳入。
      const inCorrelation = name === 'Record' && stack.length === 2 && stack[1] === 'Correlation';
      if (active || (stack.length !== 1 && !inCorrelation)) fail('健康记录的 XML 结构不合法');
      active = { name, attrs: a, manual: false, inCorrelation };
    } else if (active && name === 'MetadataEntry' && ['HKWasUserEntered', 'WasUserEntered'].includes(a.key) && /^(1|true|yes)$/iu.test(a.value || '')) active.manual = true;
    stack.push(name);
    if (self) token(`</${name}>`);
  }
  function drain(final) {
    while (buffer.length) {
      const start = buffer.indexOf('<');
      if (start < 0) {
        if (buffer.trim()) fail('健康 XML 含意外文本');
        buffer = ''; break;
      }
      if (buffer.slice(0, start).trim()) fail('健康 XML 含意外文本');
      buffer = buffer.slice(start);
      const end = tagEnd(buffer);
      if (end < 0) { if (buffer.length > 1024 * 1024 || final) fail('XML 标签过长或文件不完整'); break; }
      if (end > 1024 * 1024) fail('XML 标签过长');
      token(buffer.slice(0, end)); buffer = buffer.slice(end);
    }
  }
  const reader = stream.getReader();
  let done = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { done = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > LIMITS.xmlBytes) fail('XML 解压后超过 512 MB，请缩小导出范围');
      buffer += decoder.decode(chunk.value, { stream: true }); drain(false);
      const percent = Math.min(99, Math.floor(bytes / Math.max(size, 1) * 99));
      if (percent !== lastProgress) { lastProgress = percent; onProgress({ percent, message: `正在解析，已识别 ${out.stats.accepted.toLocaleString()} 条记录` }); }
    }
    buffer += decoder.decode(); drain(true);
    if (!root || !rootClosed || stack.length) fail('XML 文件不完整');
    return out.finish();
  } finally { if (!done) await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let n = 0; n < 8; n++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const updateCRC = (crc, bytes) => { for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return crc; };
export const crc32 = bytes => (updateCRC(0xffffffff, bytes) ^ 0xffffffff) >>> 0;

async function zipXML(file) {
  const tailStart = Math.max(0, file.size - 65557), tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50 && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) { end = i; break; }
  if (end < 0) fail('ZIP 目录缺失或文件不完整');
  const count = tail.getUint16(end + 10, true), length = tail.getUint32(end + 12, true), offset = tail.getUint32(end + 16, true);
  if (count === 65535 || length === 0xffffffff || offset === 0xffffffff) fail('暂不支持 ZIP64，请解压后选择 export.xml');
  if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true) || tail.getUint16(end + 8, true) !== count) fail('不支持分卷 ZIP');
  if (length > 16 * 1024 * 1024 || offset + length > tailStart + end) fail('ZIP 目录边界不合法');
  const directory = new DataView(await file.slice(offset, offset + length).arrayBuffer());
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let cursor = 0, target;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > length || directory.getUint32(cursor, true) !== 0x02014b50) fail('ZIP 目录损坏');
    const nameLength = directory.getUint16(cursor + 28, true), extra = directory.getUint16(cursor + 30, true), comment = directory.getUint16(cursor + 32, true);
    if (cursor + 46 + nameLength + extra + comment > length) fail('ZIP 文件名边界不合法');
    const name = utf8.decode(new Uint8Array(directory.buffer, cursor + 46, nameLength));
    if (/(^|\/)export\.xml$/iu.test(name)) {
      if (target) fail('ZIP 中存在多个 export.xml，请单独选择需要的 XML');
      if (name.includes('\\') || name.split('/').some(p => p === '..' || p === '.') || name.startsWith('/')) fail('ZIP 路径不合法');
      target = { name, flags: directory.getUint16(cursor + 8, true), method: directory.getUint16(cursor + 10, true), crc: directory.getUint32(cursor + 16, true), compressed: directory.getUint32(cursor + 20, true), size: directory.getUint32(cursor + 24, true), local: directory.getUint32(cursor + 42, true) };
      if (directory.getUint16(cursor + 34, true)) fail('不支持分卷 ZIP');
    }
    cursor += 46 + nameLength + extra + comment;
  }
  if (cursor !== length) fail('ZIP 目录大小不匹配');
  if (!target) fail('ZIP 中没有找到 export.xml');
  const { flags, method, crc, compressed, size, local } = target;
  if ([size, compressed, local].includes(0xffffffff)) fail('暂不支持 ZIP64，请解压后选择 export.xml');
  if (flags & 1 || flags & 64) fail('不支持加密 ZIP，请先解压');
  if (![0, 8].includes(method)) fail('ZIP 压缩算法不支持，请解压后选择 export.xml');
  if (size > LIMITS.xmlBytes || compressed > LIMITS.fileBytes) fail('ZIP 内的 XML 过大，请缩小导出范围');
  if (local + 30 > offset) fail('ZIP 本地目录边界不合法');
  const header = new DataView(await file.slice(local, local + 30).arrayBuffer());
  if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(6, true) !== flags || header.getUint16(8, true) !== method) fail('ZIP 本地目录不匹配');
  const nameLength = header.getUint16(26, true), extra = header.getUint16(28, true), start = local + 30 + nameLength + extra;
  if (start + compressed > offset || utf8.decode(await file.slice(local + 30, local + 30 + nameLength).arrayBuffer()) !== target.name) fail('ZIP 数据边界或文件名不匹配');
  if (!(flags & 8) && (header.getUint32(14, true) !== crc || header.getUint32(18, true) !== compressed || header.getUint32(22, true) !== size)) fail('ZIP 大小或校验信息不匹配');
  let stream = file.slice(start, start + compressed).stream();
  if (method === 8) {
    try { stream = stream.pipeThrough(new DecompressionStream('deflate-raw')); }
    catch { fail('当前浏览器不支持 ZIP 解压，请先解压并导入 export.xml'); }
  }
  let actual = 0, checksum = 0xffffffff;
  stream = stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      actual += chunk.byteLength;
      if (actual > size || actual > LIMITS.xmlBytes) fail('ZIP 解压大小超过声明上限');
      checksum = updateCRC(checksum, chunk); controller.enqueue(chunk);
    },
    flush() { if (actual !== size || ((checksum ^ 0xffffffff) >>> 0) !== crc) fail('ZIP 校验失败，文件可能已损坏'); },
  }));
  return { stream, size };
}

function journalEntry(input) {
  if (!input || typeof input !== 'object') fail('记录日志格式不合法');
  const { id, kind, value, at } = input;
  text(id, 120, '日志 ID');
  if (!timestamp(at) || at > Date.now() + 60000) fail('日志时间不合法');
  const note = text(input.note ?? '', 2000, '日志备注', true);
  if (kind === 'note') text(value, 2000, '日志内容');
  else if (kind === 'mood') { if (!Number.isInteger(value) || value < 1 || value > 5) fail('心情数值必须为 1–5'); }
  else if (kind === 'water' || kind === 'caffeine') { if (typeof value !== 'number' || !Number.isFinite(value) || (kind === 'water' ? value <= 0 || value > 10000 : value < 0 || value > 2000)) fail('饮水或咖啡因数值不合法'); }
  else fail('日志类型不支持');
  return { id, kind, value, note, at };
}

export async function parseHealthFile(file, { onProgress = () => {} } = {}) {
  if (!file || typeof file.stream !== 'function' || !Number.isFinite(file.size) || file.size <= 0) fail('请选择非空的健康数据文件');
  if (file.size > LIMITS.fileBytes) fail('文件超过 200 MB，请先解压或缩小导出范围');
  const extension = String(file.name || '').split('.').at(-1).toLowerCase();
  onProgress({ percent: 0, message: '正在检查文件' });
  if (extension === 'zip') { const { stream, size } = await zipXML(file); return parseXML(stream, size, onProgress); }
  if (extension === 'xml') return parseXML(file.stream(), file.size, onProgress);
  if (extension !== 'json') fail('支持 Apple 健康的 ZIP / XML 和本应用导出的 JSON 备份');
  let data;
  try { data = JSON.parse(await file.text()); } catch { fail('JSON 文件格式不正确'); }
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.records) || !Array.isArray(data.journal)) fail('请选择本应用导出的 schemaVersion 1 备份');
  if (data.records.length > LIMITS.records || data.journal.length > LIMITS.journal) fail('备份记录数量超过上限');
  const out = collector(onProgress), journal = [], journalIDs = new Set();
  for (const item of data.records) { out.stats.total++; out.add(normalizedRecord(item)); }
  for (const item of data.journal) {
    const entry = journalEntry(item);
    if (journalIDs.has(entry.id)) fail('备份包含重复的日志 ID');
    journalIDs.add(entry.id); journal.push(entry);
  }
  return out.finish(journal);
}
