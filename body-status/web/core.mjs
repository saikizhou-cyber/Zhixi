/** 浏览器与 Node 共用的本地健康数据分析；不生成临床压力分数。 */
export const METRICS = Object.freeze({
  heartRate: Object.freeze({ label: '心率', unit: 'bpm' }),
  hrv: Object.freeze({ label: '心率变异性', unit: 'ms' }),
  restingHeartRate: Object.freeze({ label: '静息心率', unit: 'bpm' }),
  sleep: Object.freeze({ label: '睡眠', unit: 'min' }),
  steps: Object.freeze({ label: '步数', unit: '步' }),
  activeEnergy: Object.freeze({ label: '活动能量', unit: 'kcal' }),
  respiratoryRate: Object.freeze({ label: '呼吸频率', unit: '次/分' }),
  oxygenSaturation: Object.freeze({ label: '血氧饱和度', unit: '%' }),
  workout: Object.freeze({ label: '体能训练', unit: 'min' }),
});

const LATEST_TYPES = ['heartRate', 'hrv', 'restingHeartRate', 'respiratoryRate', 'oxygenSaturation'];
const ACTIVITY_TYPES = new Set(['steps', 'activeEnergy']);
const SLEEP_STAGES = ['deep', 'core', 'rem', 'asleep', 'awake'];
const STAGE_PRIORITY = ['awake', 'deep', 'rem', 'core', 'asleep'];
const SLEEP_VALUES = new Set([...SLEEP_STAGES, 'inBed']);
const MINUTE = 60_000;

/** 不使用输入 id：同一测量即使在两次导入中被分配不同 id，也应去重。 */
export function recordKey(record) {
  return JSON.stringify([record.type, record.source, record.start, record.end, record.value, record.unit]);
}

function validTime(value) {
  return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
}

function checkNow(now) {
  if (!validTime(now)) throw new RangeError('now 必须是有效的 Unix 毫秒时间');
}

function checkDays(days) {
  if (!Number.isInteger(days) || days < 1) throw new RangeError('days 必须是正整数');
}

function validRecord(record, now) {
  if (!record || !Object.hasOwn(METRICS, record.type) || typeof record.source !== 'string' || !record.source.trim()) return false;
  if (typeof record.unit !== 'string' || !validTime(record.start) || !validTime(record.end)) return false;
  if (record.end < record.start || record.end > now) return false;
  if (record.type === 'sleep') return record.end > record.start && SLEEP_VALUES.has(record.value);
  if (record.type === 'workout') return record.end > record.start && typeof record.value === 'string' && !!record.value.trim();
  return typeof record.value === 'number' && Number.isFinite(record.value)
    && (ACTIVITY_TYPES.has(record.type) ? record.value >= 0 : record.value > 0);
}

function cleanRecords(records, now) {
  const seen = new Set();
  return records.filter(record => {
    if (!validRecord(record, now)) return false;
    const key = recordKey(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function latestRecord(records) {
  let latest = null;
  for (const record of records) {
    if (!latest || record.end > latest.end
      || (record.end === latest.end && record.start > latest.start)
      || (record.end === latest.end && record.start === latest.start && recordKey(record) > recordKey(latest))) latest = record;
  }
  return latest;
}

function dayStart(at) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function shiftDay(at, amount) {
  const date = new Date(at);
  date.setDate(date.getDate() + amount);
  return date.getTime();
}

function dayLabel(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 本地日历周期；当前周期只读到现在，历史周期只读到其结束之前。 */
export function calendarPeriod(period = 'week', anchor = null, now = Date.now()) {
  checkNow(now);
  if (!['day', 'week', 'month'].includes(period)) throw new RangeError('period 必须为 day、week 或 month');
  anchor ??= now;
  if (!validTime(anchor) || anchor > now) throw new RangeError('anchor 必须是有效且不晚于现在的时间');
  const startDate = new Date(dayStart(anchor));
  if (period === 'week') startDate.setDate(startDate.getDate() - (startDate.getDay() + 6) % 7);
  if (period === 'month') startDate.setDate(1);
  const start = +startDate;
  const endDate = new Date(start), previousDate = new Date(start);
  if (period === 'month') {
    endDate.setMonth(endDate.getMonth() + 1);
    previousDate.setMonth(previousDate.getMonth() - 1);
  } else {
    const length = period === 'week' ? 7 : 1;
    endDate.setDate(endDate.getDate() + length);
    previousDate.setDate(previousDate.getDate() - length);
  }
  const end = +endDate, previous = +previousDate;
  if (![start, end, previous].every(validTime)) throw new RangeError('周期超出有效日期范围');
  const through = Math.min(end - 1, now);
  let days = 0;
  for (let at = start; at <= through; at = shiftDay(at, 1)) days++;
  return { period, start, end, through, days, previous, next: end <= now ? end : null, isCurrent: now < end };
}

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  // 加权表达避免两个极大但有效的正数相加溢出。
  return sorted[lower] * (1 - (index - lower)) + sorted[upper] * (index - lower);
}

export function median(values) {
  return quantile(values.filter(value => typeof value === 'number' && Number.isFinite(value)), 0.5);
}

function sourceRecords(records, type, source = 'auto') {
  const matching = records.filter(record => record.type === type && (source === 'auto' || record.source === source));
  const selected = latestRecord(matching)?.source;
  return selected ? matching.filter(record => record.source === selected) : [];
}

function hrvReport(records, now, source) {
  const selected = sourceRecords(records, 'hrv', source);
  const current = latestRecord(selected);
  const result = { level: 'noData', current, baseline: null, lower: null, upper: null, days: 0, source: current?.source ?? null };
  if (!current) return result;

  const today = dayStart(now);
  const first = shiftDay(today, -28);
  const daily = new Map();
  for (const record of selected) {
    if (record.end < first || record.end >= today) continue;
    const key = dayStart(record.end);
    if (!daily.has(key)) daily.set(key, []);
    daily.get(key).push(record.value);
  }
  const medians = [...daily.values()].map(median);
  result.days = medians.length;
  if (result.days >= 7) {
    result.baseline = median(medians);
    result.lower = quantile(medians, 0.25);
    result.upper = quantile(medians, 0.75);
  }

  if (now - current.end > 30 * MINUTE) result.level = 'stale';
  else if (result.days < 7) result.level = 'building';
  else if (current.value < result.lower) result.level = 'below';
  else if (current.value > result.upper) result.level = 'above';
  else result.level = 'usual';
  return result;
}

/** 最近一晚以当天中午命名；中午之后的午睡计入下一天窗口。 */
export function sleepWindow(now = Date.now()) {
  checkNow(now);
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  return { start: shiftDay(noon.getTime(), -1), end: Math.min(now, noon.getTime()) };
}

function emptyStages() {
  return { deep: 0, core: 0, rem: 0, asleep: 0, awake: 0 };
}

function sleepFromCleanRecords(records, window) {
  // inBed 不证明已经入睡，也不用于抢占实际睡眠来源。
  const candidates = records.filter(record => record.type === 'sleep' && record.value !== 'inBed'
    && record.start < window.end && record.end > window.start);
  const selected = latestRecord(candidates)?.source ?? null;
  const relevant = selected ? candidates.filter(record => record.source === selected) : [];
  const stages = emptyStages();
  const result = { minutes: null, stages, segments: [], window, recordedStart: null, recordedEnd: null, source: selected };
  if (!relevant.length) return result;

  // 扫描所有区间端点：同一时刻只计入最高优先级阶段，重复和重叠不会叠加时长。
  const events = new Map();
  for (const record of relevant) {
    const start = Math.max(record.start, window.start);
    const end = Math.min(record.end, window.end);
    for (const [at, delta] of [[start, 1], [end, -1]]) {
      if (!events.has(at)) events.set(at, []);
      events.get(at).push([record.value, delta]);
    }
  }
  const points = [...events.keys()].sort((a, b) => a - b);
  const counts = emptyStages();
  for (let index = 0; index < points.length - 1; index++) {
    const at = points[index];
    for (const [stage, delta] of events.get(at)) counts[stage] += delta;
    const stage = STAGE_PRIORITY.find(value => counts[value] > 0);
    if (stage) {
      const end = points[index + 1];
      stages[stage] += (end - at) / MINUTE;
      const previous = result.segments.at(-1);
      if (previous?.stage === stage && previous.end === at) previous.end = end;
      else result.segments.push({ start: at, end, stage });
    }
  }
  result.minutes = stages.deep + stages.core + stages.rem + stages.asleep;
  result.recordedStart = result.segments[0].start;
  result.recordedEnd = Math.min(latestRecord(relevant).end, window.end);
  return result;
}

export function sleepReport(records, { now = Date.now() } = {}) {
  checkNow(now);
  return sleepFromCleanRecords(cleanRecords(records, now), sleepWindow(now));
}

function activityForDay(records, type, start, end) {
  // shortcut: 跨日活动区间不按时间比例猜测步数/能量，仅合计完整落在该自然日内的样本。
  const relevant = records.filter(record => record.type === type && record.start >= start
    && record.start < end && record.end <= end);
  const selected = sourceRecords(relevant, type);
  if (!selected.length) return { value: null, source: null };
  const total = selected.reduce((sum, record) => sum + record.value, 0);
  return Number.isFinite(total) ? { value: total, source: selected[0].source } : { value: null, source: null };
}

export function analyze(records, { now = Date.now(), source = 'auto' } = {}) {
  checkNow(now);
  const valid = cleanRecords(records, now);
  const latest = Object.fromEntries(LATEST_TYPES.map(type => [type, latestRecord(valid.filter(record => record.type === type
    && (type !== 'hrv' || source === 'auto' || record.source === source)))]));
  const today = dayStart(now);
  const tomorrow = shiftDay(today, 1);
  return {
    now,
    latest,
    hrv: hrvReport(valid, now, source),
    sleep: sleepFromCleanRecords(valid, sleepWindow(now)),
    activity: {
      steps: activityForDay(valid, 'steps', today, tomorrow).value,
      energy: activityForDay(valid, 'activeEnergy', today, tomorrow).value,
    },
    freshest: latestRecord(valid)?.end ?? null,
  };
}

export function dailySeries(records, type, { days = 28, now = Date.now(), source = 'auto' } = {}) {
  checkNow(now);
  checkDays(days);
  if (!LATEST_TYPES.includes(type) && !ACTIVITY_TYPES.has(type)) throw new RangeError('该指标不支持数值日趋势，请使用 sleepSeries 查看睡眠');
  const valid = cleanRecords(records, now);
  // 手动来源只用于 HRV 校准，不改变其他指标的数据来源。
  const selected = sourceRecords(valid, type, type === 'hrv' ? source : 'auto');
  const today = dayStart(now);
  return Array.from({ length: days }, (_, index) => {
    const at = shiftDay(today, index - days + 1);
    const end = shiftDay(at, 1);
    const day = ACTIVITY_TYPES.has(type)
      ? activityForDay(valid, type, at, end)
      : { value: median(selected.filter(record => record.end >= at && record.end < end).map(record => record.value)), source: selected[0]?.source ?? null };
    return { day: dayLabel(at), at, value: day.value, source: day.value === null ? null : day.source };
  });
}

/** 日视图按实际小时分桶；DST 回拨时重复的钟点保留各自时间戳。 */
export function hourlySeries(records, type, { now = Date.now(), source = 'auto' } = {}) {
  checkNow(now);
  if (!LATEST_TYPES.includes(type) && !ACTIVITY_TYPES.has(type)) throw new RangeError('该指标不支持数值小时趋势，请使用 sleepSeries 查看睡眠');
  const valid = cleanRecords(records, now);
  const start = dayStart(now), end = shiftDay(start, 1), activity = ACTIVITY_TYPES.has(type);
  const selected = sourceRecords(activity ? valid.filter(record => record.start >= start && record.start < end && record.end <= end) : valid,
    type, type === 'hrv' ? source : 'auto');
  const series = [];
  for (let at = start; at <= now; at += 60 * MINUTE) {
    const until = Math.min(at + 60 * MINUTE, end);
    // shortcut: 跨小时活动样本不按时长摊分，小时合计可能少于日合计；有细粒度原始样本后再纳入。
    const values = selected.filter(record => activity
      ? record.start >= at && record.start < until && record.end <= until
      : record.end >= at && record.end < until).map(record => record.value);
    const total = activity && values.length ? values.reduce((sum, value) => sum + value, 0) : median(values);
    const value = Number.isFinite(total) ? total : null;
    const date = new Date(at), day = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    series.push({ at, day, value, source: value === null ? null : selected[0]?.source ?? null });
  }
  return series;
}

export function sleepSeries(records, { days = 7, now = Date.now() } = {}) {
  checkNow(now);
  checkDays(days);
  const valid = cleanRecords(records, now);
  const today = dayStart(now);
  return Array.from({ length: days }, (_, index) => {
    const at = shiftDay(today, index - days + 1);
    const noon = new Date(at);
    noon.setHours(12, 0, 0, 0);
    const window = { start: shiftDay(noon.getTime(), -1), end: Math.min(noon.getTime(), now) };
    const { minutes, stages, source, segments, recordedStart, recordedEnd } = sleepFromCleanRecords(valid, window);
    return { day: dayLabel(at), at, minutes, stages, source, window, segments, recordedStart, recordedEnd };
  });
}

/** 分档只描述个人历史分布；不同来源各自建档，不代表医学正常范围。 */
export function personalBands(records, { now = Date.now() } = {}) {
  checkNow(now);
  const valid = cleanRecords(records, now);
  const today = dayStart(now), first = shiftDay(today, -28), noonStart = sleepWindow(now).start;
  const groups = new Map();
  for (const record of valid) {
    if (record.type === 'workout') continue;
    const key = JSON.stringify([record.type, record.source]);
    if (!groups.has(key)) groups.set(key, { type: record.type, source: record.source, records: [] });
    groups.get(key).records.push(record);
  }
  const bands = new Map();
  for (const [key, group] of groups) {
    let values;
    if (group.type === 'sleep') {
      values = Array.from({ length: 28 }, (_, index) => {
        const end = shiftDay(noonStart, -index);
        return sleepFromCleanRecords(group.records, { start: shiftDay(end, -1), end }).minutes;
      });
    } else {
      const daily = new Map();
      const activity = ACTIVITY_TYPES.has(group.type);
      for (const record of group.records) {
        const at = dayStart(activity ? record.start : record.end);
        if (at < first || at >= today || (activity && record.end > shiftDay(at, 1))) continue;
        if (!daily.has(at)) daily.set(at, []);
        daily.get(at).push(record.value);
      }
      values = [...daily.values()].map(day => activity ? day.reduce((total, value) => total + value, 0) : median(day));
    }
    values = values.filter(Number.isFinite);
    bands.set(key, { type: group.type, source: group.source, days: values.length,
      lower: values.length >= 7 ? quantile(values, .25) : null,
      upper: values.length >= 7 ? quantile(values, .75) : null });
  }
  return bands;
}

export function relativeLevel(value, band, { stale = false } = {}) {
  if (!Number.isFinite(value)) return 'noData';
  if (stale) return 'stale';
  if (!band || !Number.isInteger(band.days) || band.days < 7 || !Number.isFinite(band.lower)
    || !Number.isFinite(band.upper) || band.lower > band.upper) return 'building';
  return value < band.lower ? 'below' : value > band.upper ? 'above' : 'usual';
}

function recoverySignal(type, value, source, recordedEnd, history, stale) {
  const result = { type, value, source, recordedEnd, baseline: null, lower: null, upper: null, days: history.length, level: 'noData' };
  if (history.length >= 7) {
    result.baseline = median(history);
    result.lower = quantile(history, 0.25);
    result.upper = quantile(history, 0.75);
  }
  if (value !== null) result.level = stale ? 'stale' : history.length < 7 ? 'building'
    : value < result.lower ? 'below' : value > result.upper ? 'above' : 'usual';
  return result;
}

/** 各项独立与个人历史比较；不将偏离方向解释为健康好坏或合成恢复分数。 */
export function recoveryReport(records, { now = Date.now(), source = 'auto' } = {}) {
  checkNow(now);
  const valid = cleanRecords(records, now);
  const today = dayStart(now), first = shiftDay(today, -28);
  const signals = ['hrv', 'restingHeartRate', 'respiratoryRate', 'oxygenSaturation'].map(type => {
    const selected = sourceRecords(valid, type, type === 'hrv' ? source : 'auto');
    const latest = latestRecord(selected);
    const history = new Map(), current = [];
    for (const record of selected) {
      if (record.end >= today) current.push(record.value);
      else if (record.end >= first) {
        const day = dayStart(record.end);
        if (!history.has(day)) history.set(day, []);
        history.get(day).push(record.value);
      }
    }
    return recoverySignal(type, current.length ? median(current) : latest?.value ?? null,
      latest?.source ?? null, latest?.end ?? null, [...history.values()].map(median), !current.length);
  });

  const window = sleepWindow(now);
  let current = sleepFromCleanRecords(valid, window);
  const stale = current.minutes === null;
  if (stale) {
    const latest = latestRecord(valid.filter(record => record.type === 'sleep' && record.value !== 'inBed' && record.end <= window.start));
    if (latest) {
      const noon = new Date(latest.end);
      noon.setHours(12, 0, 0, 0);
      const end = latest.end > +noon ? shiftDay(+noon, 1) : +noon;
      current = sleepFromCleanRecords(valid.filter(record => record.source === latest.source), { start: shiftDay(end, -1), end });
    }
  }
  const sleepRecords = valid.filter(record => record.type === 'sleep' && record.source === current.source);
  const history = [];
  for (let offset = 0; offset < 28; offset++) {
    const end = shiftDay(window.start, -offset);
    const { minutes } = sleepFromCleanRecords(sleepRecords, { start: shiftDay(end, -1), end });
    if (minutes !== null) history.push(minutes);
  }
  signals.splice(2, 0, recoverySignal('sleep', current.minutes, current.source, current.recordedEnd, history, stale));
  return { signals };
}

function intervalMinutes(records, start, end) {
  const intervals = records.filter(record => record.start < end && record.end > start)
    .map(record => [Math.max(record.start, start), Math.min(record.end, end)]).sort((a, b) => a[0] - b[0]);
  if (!intervals.length) return null;
  let total = 0, cursor = start;
  for (const [from, to] of intervals) {
    total += Math.max(0, to - Math.max(from, cursor));
    cursor = Math.max(cursor, to);
  }
  return total / MINUTE;
}

/** 仅统计窗口内开始且已结束的训练；心率是同来源离散样本，不推算连续心率或区间时长。 */
export function workoutReport(records, { now = Date.now(), days = 7 } = {}) {
  checkNow(now);
  checkDays(days);
  const valid = cleanRecords(records, now);
  const today = dayStart(now), first = shiftDay(today, 1 - days);
  const selected = sourceRecords(valid.filter(record => record.start >= first), 'workout');
  const source = selected[0]?.source ?? null;
  const hearts = valid.filter(record => record.type === 'heartRate' && record.source === source);
  const items = selected.map(record => {
    const values = hearts.filter(heart => heart.start >= record.start && heart.end <= record.end).map(heart => heart.value);
    return { ...record, duration: (record.end - record.start) / MINUTE,
      heartRate: { count: values.length, median: median(values),
        min: values.length ? values.reduce((min, value) => Math.min(min, value)) : null,
        max: values.length ? values.reduce((max, value) => Math.max(max, value)) : null } };
  }).sort((a, b) => b.end - a.end || b.start - a.start || recordKey(b).localeCompare(recordKey(a)));
  const daily = Array.from({ length: days }, (_, index) => {
    const at = shiftDay(first, index), end = shiftDay(at, 1);
    return { day: dayLabel(at), at, minutes: intervalMinutes(selected, at, end),
      count: selected.filter(record => record.start >= at && record.start < end).length };
  });
  return { source, count: items.length, minutes: intervalMinutes(selected, first, now),
    activeDays: daily.filter(day => day.minutes !== null).length, items, daily };
}
