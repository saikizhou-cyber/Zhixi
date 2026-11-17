import { recordKey, median, relativeLevel, sleepWindow } from './core.mjs';

/** 汇总今日可比较的记录，不将范围偏离合成为压力或健康分数。 */
export function dailyOverview(recovery, { now = Date.now() } = {}) {
  const window = sleepWindow(now);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const signals = ['hrv', 'restingHeartRate', 'sleep'].map(type => {
    const signal = recovery?.signals?.find(item => item.type === type) || { type, value: null, source: null, recordedEnd: null, days: 0 };
    const current = Number.isFinite(signal.value) && Number.isFinite(signal.recordedEnd)
      && signal.recordedEnd <= now && signal.level !== 'stale'
      && (type === 'sleep' ? signal.recordedEnd > window.start && signal.recordedEnd <= window.end : signal.recordedEnd >= +today);
    const key = current && type === 'sleep' && new Date(now).getHours() < 12 ? 'partial'
      : relativeLevel(signal.value, signal, { stale: !current });
    return { ...signal, key, current, comparable: ['below', 'usual', 'above'].includes(key) };
  });
  const available = signals.filter(signal => signal.current).length;
  const comparable = signals.filter(signal => signal.comparable).length;
  const concerns = signals.filter(signal => signal.comparable && signal.key === (signal.type === 'restingHeartRate' ? 'above' : 'below')).map(signal => signal.type);
  const key = !available ? 'noData' : concerns.length ? 'care'
    : !comparable && signals.some(signal => signal.key === 'building') ? 'building'
    : comparable < 3 ? 'incomplete' : signals.every(signal => signal.key === 'usual') ? 'usual' : 'changed';
  const descriptions = {
    noData: ['unknown', '等待今天的记录', '今天还没有可用的身体记录。有最新记录后，再一起看看今日状态。'],
    building: ['unknown', '慢慢了解今天的你', `已有 ${available} / 3 项记录，个人参照还在积累。再多一些同来源记录后，比较才更有依据。`],
    incomplete: ['unknown', '今日信息还不完整', `当前 ${available} / 3 项有记录，${comparable} 项可比较。已有信息还不足以概括今日整体，缺失的部分先留白。`],
    usual: ['positive', '今日接近日常', '三项已记录指标都在个人常见范围内。按熟悉的节奏继续，也留意自己的感受。'],
    care: ['care', '今天，给恢复留点空间', `已可比较的 ${comparable} 项中，${concerns.length} 项值得温和关照。可以放慢一点，结合自己的感受看看需要什么${comparable < 3 ? '；其余信息尚不完整' : ''}。`],
    changed: ['neutral', '今天有些不同', '已记录指标出现个人范围之外的变化，先结合当天活动与感受观察，不急着评价好坏。'],
  };
  const [tone, title, message] = descriptions[key];
  return { key, tone, title, message, available, comparable, total: signals.length,
    lastUpdated: available ? Math.max(...signals.filter(signal => signal.current).map(signal => signal.recordedEnd)) : null,
    signals, concerns };
}

/** 描述界面中的记录量与主观心情，不是摄入建议或运动强度标准。 */
export function recordGrade(kind, value) {
  if (!Number.isFinite(value) || value < 0) return { key: 'noData', label: '暂无记录', hint: '没有记录不代表零。' };
  if (kind === 'mood') {
    if (value < 1 || value > 5) return { key: 'noData', label: '暂无有效心情', hint: '心情使用 1–5 分。' };
    const names = ['很低落', '有些低落', '平常', '比较舒畅', '很舒畅'];
    const label = Number.isInteger(value) ? names[value - 1] : `${names[Math.floor(value) - 1]}—${names[Math.ceil(value) - 1]}`;
    return { kind, key: 'mood', mood: value, rank: value - 1, label, hint: Number.isInteger(value) ? `主观心情 ${value} / 5，不是心理量表。` : `中位数 ${value} / 5，介于相邻两档；保留原值。` };
  }
  const rules = { water: [500, 1500, 'ml'], caffeine: [100, 200, 'mg'], workout: [20, 60, '分'] };
  if (!Object.hasOwn(rules, kind)) return { key: 'noData', label: '不分级', hint: '文字记录不作数值判断。' };
  const [lower, upper, unit] = rules[kind];
  if (value === 0) return { kind, key: 'zero', label: '零值记录', hint: `已记录 0 ${unit}，与缺失记录不同。` };
  const rank = value < lower ? 0 : value < upper ? 1 : 2;
  return { kind, key: ['low', 'mid', 'high'][rank], rank,
    label: kind === 'workout' ? ['短时记录', '中时记录', '长时记录'][rank] : ['少量记录', '中量记录', '较多记录'][rank],
    hint: `${['大于 0 且小于 ' + lower, lower + ' 至小于 ' + upper, upper + ' 及以上'][rank]} ${unit}；${kind === 'workout' ? '仅描述时长，不代表强度。' : '仅描述记录量，不是摄入建议。'}` };
}

export function mergeData(current, incoming) {
  const records = new Map(current.records.map(r => [recordKey(r), r]));
  const before = records.size;
  for (const r of incoming.records) records.set(recordKey(r), { ...r, id: recordKey(r) });
  if (records.size > 250000) throw new Error('合并后超过 250,000 条记录的本地容量限制。请保留原备份，改为导入较短时间范围。');
  const journal = new Map(current.journal.map(entry => [entry.id, entry]));
  for (const entry of incoming.journal ?? []) if (!journal.has(entry.id)) journal.set(entry.id, entry);
  if (journal.size > 10000) throw new Error('日志超过 10,000 条，请先导出备份。');
  return { records: [...records.values()], journal: [...journal.values()], added: records.size - before };
}

export function journalEntry(fields, now = Date.now()) {
  const kind = fields.kind;
  if (!['mood', 'water', 'caffeine', 'note'].includes(kind)) throw new Error('请选择有效的记录类型。');
  const note = String(fields.note ?? '').trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note + String(fields.value ?? ''))) throw new Error('记录中包含不可保存的控制字符，请移除后重试。');
  if (note.length > 2000) throw new Error('备注最多 2,000 个字符。');
  const at = new Date(fields.at).getTime();
  if (!Number.isFinite(at) || at < 0 || at > now + 60000) throw new Error('请填写有效的记录时间，不能晚于现在。');
  let value = kind === 'note' ? String(fields.value ?? '').trim() : Number(fields.value);
  if (kind === 'note') {
    if (!value) value = note;
    if (!value || value.length > 2000) throw new Error('请填写 1–2,000 个字符的记录。');
  } else {
    if (String(fields.value ?? '').trim() === '' || !Number.isFinite(value)) throw new Error('请填写有效数字。');
    if (kind === 'mood' && (!Number.isInteger(value) || value < 1 || value > 5)) throw new Error('心情使用 1–5 分：1 很低落，5 很舒畅。');
    if (kind === 'water' && (value <= 0 || value > 10000)) throw new Error('单次饮水量请输入 1–10,000 ml。');
    if (kind === 'caffeine' && (value < 0 || value > 2000)) throw new Error('咖啡因请输入 0–2,000 mg。');
  }
  return { id: crypto.randomUUID(), kind, value, note, at };
}

/** 只汇总实际记录；未记录的饮水、咖啡因和心情均保持未知。 */
export function journalReport(journal, { now = Date.now(), days = 7 } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new RangeError('now 必须是有效时间');
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new RangeError('days 必须为 1–90');
  const daily = Array.from({ length: days }, (_, index) => {
    const at = new Date(now); at.setHours(0, 0, 0, 0); at.setDate(at.getDate() + index - days + 1);
    const end = new Date(at); end.setDate(end.getDate() + 1);
    return { at: +at, end: +end, water: null, caffeine: null, mood: null, count: 0, moods: [] };
  });
  const seen = new Set();
  for (const row of journal) {
    if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id) || !Number.isFinite(row.at) || row.at > now) continue;
    const valid = row.kind === 'mood' ? Number.isInteger(row.value) && row.value >= 1 && row.value <= 5
      : row.kind === 'water' ? Number.isFinite(row.value) && row.value > 0 && row.value <= 10000
      : row.kind === 'caffeine' ? Number.isFinite(row.value) && row.value >= 0 && row.value <= 2000
      : row.kind === 'note' && typeof row.value === 'string' && !!row.value.trim();
    if (!valid) continue;
    seen.add(row.id);
    const day = daily.find(day => row.at >= day.at && row.at < day.end);
    if (!day) continue;
    day.count++;
    if (row.kind === 'mood') day.moods.push(row.value);
    else if (row.kind === 'water' || row.kind === 'caffeine') day[row.kind] = (day[row.kind] ?? 0) + row.value;
  }
  for (const day of daily) { day.mood = median(day.moods); delete day.moods; }
  const sum = kind => daily.some(day => day[kind] !== null) ? daily.reduce((total, day) => total + (day[kind] ?? 0), 0) : null;
  return { daily, today: daily.at(-1), recordedDays: daily.filter(day => day.count).length,
    water: sum('water'), caffeine: sum('caffeine'), mood: median(daily.map(day => day.mood)) };
}
