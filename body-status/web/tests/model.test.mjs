import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeData, journalEntry, journalReport, recordGrade, dailyOverview } from '../model.mjs';
import { recoveryReport, METRICS } from '../core.mjs';
import { demoData } from '../demo.mjs';

const overviewNow = +new Date(2026, 10, 17, 14);
const overviewSignal = (type, patch = {}) => ({ type, value: type === 'sleep' ? 480 : 50,
  source: 'Apple Watch', recordedEnd: +new Date(2026, 10, 17, 8), days: 7,
  lower: type === 'sleep' ? 450 : 45, upper: type === 'sleep' ? 510 : 55, level: 'usual', ...patch });
const overviewSignals = () => ['hrv', 'restingHeartRate', 'sleep'].map(type => overviewSignal(type));

test('今日总结仅在三项均可比较且位于个人范围内时给出积极总体反馈', () => {
  const signals = overviewSignals();
  const before = structuredClone(signals);
  const result = dailyOverview({ signals }, { now: overviewNow });
  assert.equal(result.key, 'usual'); assert.equal(result.tone, 'positive');
  assert.equal(result.available, 3); assert.equal(result.comparable, 3); assert.equal(result.total, 3);
  assert.equal(result.lastUpdated, +new Date(2026, 10, 17, 8));
  assert.ok(result.signals.every(signal => signal.current && signal.comparable));
  assert.deepEqual(result.concerns, []); assert.deepEqual(signals, before);
  const incomplete = dailyOverview({ signals: signals.slice(0, 2) }, { now: overviewNow });
  assert.equal(incomplete.key, 'incomplete'); assert.equal(incomplete.tone, 'unknown');
  assert.equal(incomplete.comparable, 2); assert.equal(incomplete.signals[2].key, 'noData');
  assert.doesNotMatch(result.title + result.message, /压力正常|健康正常|健康分数/);
});

test('今日总结的关怀方向按指标分别判断，其他偏离保持中性', () => {
  for (const type of ['hrv', 'restingHeartRate', 'sleep']) {
    const signals = overviewSignals();
    const signal = signals.find(item => item.type === type);
    signal.value = type === 'restingHeartRate' ? signal.upper + 1 : signal.lower - 1;
    const result = dailyOverview({ signals }, { now: overviewNow });
    assert.equal(result.key, 'care', type); assert.equal(result.tone, 'care');
    assert.deepEqual(result.concerns, [type]);
    signal.value = type === 'restingHeartRate' ? signal.lower - 1 : signal.upper + 1;
    const changed = dailyOverview({ signals }, { now: overviewNow });
    assert.equal(changed.key, 'changed', type); assert.equal(changed.tone, 'neutral');
    assert.deepEqual(changed.concerns, []);
  }
  const partial = dailyOverview({ signals: [overviewSignal('hrv', { value: 30 })] }, { now: overviewNow });
  assert.equal(partial.key, 'care'); assert.equal(partial.comparable, 1);
  assert.match(partial.message, /已可比较的 1 项/); assert.match(partial.message, /其余信息尚不完整/);
});

test('没有今日记录时保持未知，历史、未来和无效时间不充当今日状态', () => {
  const empty = dailyOverview(undefined, { now: overviewNow });
  assert.equal(empty.key, 'noData'); assert.equal(empty.lastUpdated, null);
  for (const patch of [{ recordedEnd: +new Date(2026, 10, 16, 23, 59) }, { recordedEnd: overviewNow + 1 },
    { recordedEnd: null }, { recordedEnd: NaN }, { level: 'stale' }]) {
    const result = dailyOverview({ signals: [overviewSignal('hrv', patch)] }, { now: overviewNow });
    assert.equal(result.key, 'noData'); assert.equal(result.available, 0); assert.equal(result.comparable, 0);
    assert.equal(result.signals[0].key, 'stale');
  }
  for (const value of [null, undefined, NaN, Infinity]) {
    const result = dailyOverview({ signals: [overviewSignal('hrv', { value })] }, { now: overviewNow });
    assert.equal(result.key, 'noData'); assert.equal(result.signals[0].key, 'noData');
  }
  for (const now of [NaN, Infinity, '2026-11-17', 9e20]) assert.throws(() => dailyOverview({ signals: [] }, { now }));
});

test('睡眠沿用昨午至今午窗口，午前不与完整睡眠窗口比较', () => {
  const signals = overviewSignals();
  signals[2].value = 200;
  const morning = dailyOverview({ signals }, { now: +new Date(2026, 10, 17, 11, 59) });
  assert.equal(morning.signals[2].key, 'partial'); assert.equal(morning.signals[2].current, true);
  assert.equal(morning.available, 3); assert.equal(morning.comparable, 2); assert.equal(morning.key, 'incomplete');
  const noon = dailyOverview({ signals }, { now: +new Date(2026, 10, 17, 12) });
  assert.equal(noon.signals[2].key, 'below'); assert.equal(noon.key, 'care');
  signals[2].recordedEnd = +new Date(2026, 10, 16, 23);
  assert.equal(dailyOverview({ signals }, { now: overviewNow }).signals[2].current, true);
  for (const at of [+new Date(2026, 10, 16, 12), +new Date(2026, 10, 17, 12, 1)]) {
    signals[2].recordedEnd = at;
    const result = dailyOverview({ signals }, { now: overviewNow });
    assert.equal(result.signals[2].key, 'stale'); assert.equal(result.key, 'incomplete');
  }
});

test('缺少个人基线时不把偏离猜为好坏，额外生命体征不偷换三项覆盖率', () => {
  const incompleteBands = [{ days: 6 }, { lower: null }, { upper: Infinity }, { lower: 100, upper: 50 }];
  for (const band of incompleteBands) {
    const result = dailyOverview({ signals: [overviewSignal('hrv', { ...band, value: 20 })] }, { now: overviewNow });
    assert.equal(result.key, 'building'); assert.equal(result.comparable, 0);
    assert.equal(result.signals[0].key, 'building'); assert.deepEqual(result.concerns, []);
  }
  const extra = dailyOverview({ signals: [overviewSignal('respiratoryRate'), overviewSignal('oxygenSaturation')] }, { now: overviewNow });
  assert.equal(extra.available, 0); assert.equal(extra.key, 'noData'); assert.equal(extra.total, 3);
});

test('今日总结与真实 recoveryReport 集成，换来源不借用旧来源基线', () => {
  const records = [];
  for (let day = 10; day <= 17; day++) {
    const end = +new Date(2026, 10, day, 8);
    for (const type of ['hrv', 'restingHeartRate', 'sleep']) records.push({ type,
      value: type === 'sleep' ? 'asleep' : 50, start: type === 'sleep' ? end - 480 * 60_000 : end,
      end, source: 'Apple Watch', unit: METRICS[type].unit });
  }
  const stable = dailyOverview(recoveryReport(records, { now: overviewNow }), { now: overviewNow });
  assert.equal(stable.key, 'usual'); assert.equal(stable.comparable, 3);
  records.push({ type: 'hrv', value: 20, start: overviewNow, end: overviewNow, source: 'New Watch', unit: 'ms' });
  const switched = dailyOverview(recoveryReport(records, { now: overviewNow }), { now: overviewNow });
  assert.equal(switched.key, 'incomplete'); assert.equal(switched.comparable, 2);
  assert.equal(switched.signals[0].source, 'New Watch'); assert.equal(switched.signals[0].key, 'building');
  assert.deepEqual(switched.concerns, []);
});

test('增量合并使用规范字段去重且不改变输入，日志冲突保留本机记录', () => {
  const r = { id: 'old', type: 'hrv', value: 50, start: 100, end: 100, source: 'Watch', unit: 'ms' };
  const current = { records: [r], journal: [{ id: 'a', note: 'local' }] };
  const result = mergeData(current, { records: [{ ...r, id: 'new' }], journal: [{ id: 'a', note: 'incoming' }, { id: 'b' }] });
  assert.equal(result.added, 0); assert.equal(result.records.length, 1);
  assert.equal(result.journal[0].note, 'local'); assert.equal(result.journal.length, 2);
  assert.equal(current.records[0].id, 'old'); assert.equal(current.journal.length, 1);
});

test('日志边界：禁止空数值、无效日期、未来日期和超限内容', () => {
  const base = { kind: 'water', value: '300', at: '2026-05-10T09:00:00+08:00', note: '' };
  const now = Date.parse('2026-05-10T10:00:00+08:00');
  assert.equal(journalEntry(base, now).value, 300);
  for (const patch of [{ value: '' }, { value: '-1' }, { value: 'Infinity' }, { at: 'invalid' }, { at: '2026-05-11' }, { note: 'x'.repeat(2001) }, { note: '\u0001' }, { kind: 'invalid' }]) assert.throws(() => journalEntry({ ...base, ...patch }, now));
  assert.throws(() => journalEntry({ ...base, kind: 'mood', value: '2.5' }, now));
  assert.equal(journalEntry({ ...base, kind: 'note', value: '', note: '午后散步' }, now).value, '午后散步');
});

test('演示样本有来源标记且无未来数据，反复生成不共享可变对象', () => {
  const now = Date.parse('2026-05-10T10:00:00+08:00');
  const first = demoData(now), second = demoData(now);
  assert.ok(first.records.length > 400);
  assert.ok(first.records.every(r => r.source.startsWith('演示') && r.end <= now));
  first.records[0].value = -1;
  assert.notEqual(second.records[0].value, -1);
});

test('生活汇总按本地自然日去重，未知与主动记录的零不同', () => {
  const now = +new Date(2026, 10, 17, 12);
  const midnight = +new Date(2026, 10, 17);
  const row = (id, kind, value, at = midnight) => ({ id, kind, value, at, note: '' });
  const records = [row('a', 'water', 200), row('a', 'water', 200), row('b', 'water', 300),
    row('c', 'caffeine', 0), row('d', 'mood', 2), row('e', 'mood', 4),
    row('f', 'water', 150, midnight - 1), row('g', 'mood', 5, midnight - 1),
    row('future', 'water', 400, now + 1), row('invalid', 'mood', 9), row('nan', 'water', NaN), null];
  const before = structuredClone(records);
  const report = journalReport(records, { now, days: 7 });
  assert.equal(report.today.water, 500);
  assert.equal(report.today.caffeine, 0);
  assert.equal(report.today.mood, 3);
  assert.equal(report.today.count, 5);
  assert.equal(report.water, 650);
  assert.equal(report.mood, 4);
  assert.equal(report.recordedDays, 2);
  assert.equal(report.daily[0].water, null);
  assert.equal(report.daily[5].caffeine, null);
  assert.deepEqual(records, before);
  const empty = journalReport([], { now });
  assert.equal(empty.water, null); assert.equal(empty.caffeine, null); assert.equal(empty.mood, null);
  assert.equal(empty.recordedDays, 0);
});

test('生活回顾范围不跨选定日期，排除非法数据并拒绝非法参数', () => {
  const now = +new Date(2026, 10, 17, 12);
  const records = [
    { id: 'old', kind: 'water', value: 300, at: +new Date(2026, 10, 10, 23, 59) },
    { id: 'first', kind: 'note', value: '开始记录', at: +new Date(2026, 10, 11) },
    { id: 'bad', kind: 'caffeine', value: -1, at: now },
    { id: 'empty', kind: 'note', value: '', at: now },
    { id: 'string', kind: 'water', value: '300', at: now },
  ];
  const r = journalReport(records, { now, days: 7 });
  assert.equal(r.recordedDays, 1); assert.equal(r.daily[0].count, 1); assert.equal(r.water, null);
  for (const days of [0, 91, NaN, 1.5]) assert.throws(() => journalReport([], { now, days }));
  assert.throws(() => journalReport([], { now: Infinity }));
});

test('记录量与训练时长分档边界明确，零值与未知独立', () => {
  const cases = {
    water: [[0, 'zero'], [499, 'low'], [500, 'mid'], [1499, 'mid'], [1500, 'high']],
    caffeine: [[0, 'zero'], [99, 'low'], [100, 'mid'], [199, 'mid'], [200, 'high']],
    workout: [[0, 'zero'], [19.9, 'low'], [20, 'mid'], [59.9, 'mid'], [60, 'high']],
  };
  for (const [kind, values] of Object.entries(cases)) {
    for (const [value, key] of values) {
      const grade = recordGrade(kind, value);
      assert.equal(grade.key, key, `${kind} ${value}`);
      assert.doesNotMatch(grade.label, /健康|正常|达标|安全|危险|过量/);
      if (value > 0) assert.match(grade.hint, kind === 'workout' ? /不代表强度/ : /不是摄入建议/);
    }
    for (const value of [null, undefined, NaN, Infinity, -1, '100']) assert.equal(recordGrade(kind, value).key, 'noData');
  }
  assert.equal(recordGrade('__proto__', 1).key, 'noData');
  assert.equal(recordGrade('note', 1).label, '不分级');
});

test('五档心情保持主观语义，中位数不四舍五入成单档', () => {
  const names = ['很低落', '有些低落', '平常', '比较舒畅', '很舒畅'];
  for (let value = 1; value <= 5; value++) {
    const grade = recordGrade('mood', value);
    assert.equal(grade.key, 'mood'); assert.equal(grade.mood, value);
    assert.equal(grade.rank, value - 1); assert.equal(grade.label, names[value - 1]);
    assert.match(grade.hint, /不是心理量表/);
  }
  const between = recordGrade('mood', 2.5);
  assert.equal(between.mood, 2.5); assert.equal(between.rank, 1.5);
  assert.equal(between.label, '有些低落—平常');
  assert.match(between.hint, /中位数 2\.5/); assert.match(between.hint, /保留原值/);
  for (const value of [0, 6, -1, null, NaN]) assert.equal(recordGrade('mood', value).key, 'noData');
});
