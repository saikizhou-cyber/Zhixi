import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { analyze, calendarPeriod, dailySeries, hourlySeries, median, METRICS, personalBands, recordKey, recoveryReport, relativeLevel, sleepReport, sleepSeries, sleepWindow, workoutReport } from '../core.mjs';

const minute = 60_000;
const date = (day, hour = 0, min = 0) => new Date(2026, 10, day, hour, min).getTime();
const now = date(17, 9);
const sample = (type, value, end = now, options = {}) => ({
  id: `${type}-${end}-${value}`, type, value, start: end, end,
  unit: METRICS[type].unit, source: 'Apple Watch', ...options,
});
const sleep = (stage, start, end, options = {}) => sample('sleep', stage, end, { start, ...options });
const history = values => values.map((value, index) => sample('hrv', value, date(16 - index, 8)));

test('稳定去重键忽略 id，保留来源、单位、时间和值', () => {
  const record = sample('hrv', 50);
  assert.equal(recordKey(record), recordKey({ ...record, id: 'reimport' }));
  for (const patch of [{ source: 'Phone' }, { value: 51 }, { start: now - 1 }, { end: now - 1 }, { unit: 's' }, { type: 'heartRate' }]) {
    assert.notEqual(recordKey(record), recordKey({ ...record, ...patch }));
  }
});

test('空数据返回未知，不能把没记录当成 0 或正常', () => {
  const result = analyze([], { now });
  assert.equal(result.hrv.level, 'noData');
  assert.equal(result.hrv.baseline, null);
  assert.equal(result.hrv.source, null);
  assert.equal(result.sleep.minutes, null);
  assert.equal(result.activity.steps, null);
  assert.equal(result.activity.energy, null);
  assert.equal(result.freshest, null);
  for (const metric of Object.values(result.latest)) assert.equal(metric, null);
});

test('过滤未来、非有限值、负数、非法时间和倒置区间', () => {
  const good = sample('heartRate', 70, now - minute);
  const invalid = [
    sample('heartRate', 90, now + 1), sample('heartRate', Number.NaN),
    sample('heartRate', Infinity), sample('heartRate', -60), sample('heartRate', 0),
    sample('heartRate', '80'), sample('heartRate', 75, Infinity),
    sample('heartRate', 75, Number.NaN), sample('heartRate', 75, now, { start: now + 1 }),
    sample('heartRate', 75, now, { source: '' }), sample('heartRate', 75, now, { unit: null }),
    sample('hrv', 0), sample('steps', -1), sample('activeEnergy', -1),
    { ...good, type: 'unknown' }, null,
  ];
  const result = analyze([good, ...invalid], { now });
  assert.equal(result.latest.heartRate, good);
  assert.equal(result.latest.hrv, null);
  assert.equal(result.freshest, good.end);
  assert.equal(result.activity.steps, null);
});

test('每个最新指标独立选取；HRV 来源选择不限制其他指标', () => {
  const records = [sample('hrv', 40, now - 100, { source: 'A' }), sample('hrv', 60, now, { source: 'B' }),
    sample('heartRate', 72, now, { source: 'B' }), sample('restingHeartRate', 56),
    sample('respiratoryRate', 15), sample('oxygenSaturation', 98)];
  const result = analyze(records, { now, source: 'A' });
  assert.equal(result.latest.hrv.value, 40);
  assert.equal(result.hrv.source, 'A');
  assert.equal(result.latest.heartRate.source, 'B');
  assert.equal(result.latest.restingHeartRate.value, 56);
  assert.equal(result.latest.respiratoryRate.value, 15);
  assert.equal(result.latest.oxygenSaturation.value, 98);
  assert.equal(analyze(records, { now, source: 'Missing' }).hrv.level, 'noData');
});

test('HRV 达到七个历史自然日才建立个人范围', () => {
  const current = sample('hrv', 40);
  const six = analyze([...history([10, 20, 30, 40, 50, 60]), current], { now }).hrv;
  assert.equal(six.level, 'building');
  assert.equal(six.days, 6);
  assert.equal(six.baseline, null);
  assert.equal(six.lower, null);
  assert.equal(six.upper, null);
  const seven = analyze([...history([10, 20, 30, 40, 50, 60, 70]), current], { now }).hrv;
  assert.equal(seven.days, 7);
  assert.equal(seven.level, 'usual');
  assert.equal(seven.baseline, 40);
  assert.equal(seven.lower, 25);
  assert.equal(seven.upper, 55);
});

test('每日中位数等权、同来源、排除今天和 28 天前的样本', () => {
  const dense = Array.from({ length: 100 }, (_, index) => sample('hrv', 100, date(16, 8) + index * 1000));
  const old = new Date(now);
  old.setDate(old.getDate() - 29);
  const records = [...history([100, 20, 30, 40, 50, 60, 70]), ...dense,
    ...history([900, 800, 700, 600, 500, 400, 300]).map(record => ({ ...record, source: 'Other' })),
    sample('hrv', 1, old.getTime()), sample('hrv', 999, date(17, 6)), sample('hrv', 50)];
  const result = analyze(records, { now }).hrv;
  assert.equal(result.days, 7);
  assert.equal(result.baseline, 50);
  assert.equal(result.lower, 35);
  assert.equal(result.upper, 65);
  assert.equal(result.source, 'Apple Watch');
});

test('HRV 范围两端属于 usual，严格越界分别 below / above', () => {
  const baseline = history([10, 20, 30, 40, 50, 60, 70]);
  for (const [value, level] of [[24, 'below'], [25, 'usual'], [55, 'usual'], [56, 'above']]) {
    assert.equal(analyze([...baseline, sample('hrv', value)], { now }).hrv.level, level);
  }
});

test('超过 30 分钟即陈旧，优先于基线建立中', () => {
  assert.equal(analyze([sample('hrv', 50, now - 30 * minute)], { now }).hrv.level, 'building');
  const result = analyze([sample('hrv', 50, now - 30 * minute - 1)], { now }).hrv;
  assert.equal(result.level, 'stale');
  assert.equal(result.days, 0);
  const staleWithBaseline = analyze([...history([10, 20, 30, 40, 50, 60, 70]), sample('hrv', 90, now - 31 * minute)], { now }).hrv;
  assert.equal(staleWithBaseline.level, 'stale');
  assert.equal(staleWithBaseline.baseline, 40);
});

test('自动 HRV 来源由最近样本决定，不把旧设备基线套到新设备', () => {
  const result = analyze([...history([10, 20, 30, 40, 50, 60, 70]), sample('hrv', 80, now, { source: 'New Watch' })], { now }).hrv;
  assert.equal(result.level, 'building');
  assert.equal(result.days, 0);
  assert.equal(result.source, 'New Watch');
});

test('28 日基线包含第 28 个自然日，排除第 29 日及当日', () => {
  const records = Array.from({ length: 28 }, (_, index) => sample('hrv', 40, date(16 - index, 8)));
  const result = analyze([...records, sample('hrv', 9999, date(17 - 29, 8)), sample('hrv', 90)], { now }).hrv;
  assert.equal(result.days, 28);
  assert.equal(result.baseline, 40);
  assert.equal(result.lower, 40);
  assert.equal(result.upper, 40);
  assert.equal(result.level, 'above');
});

test('睡眠窗口遵循本地午间边界并裁剪当天未到的中午', () => {
  assert.deepEqual(sleepWindow(now), { start: date(16, 12), end: date(17, 9) });
  assert.deepEqual(sleepWindow(date(17, 18)), { start: date(16, 12), end: date(17, 12) });
  const report = sleepReport([sleep('asleep', date(16, 11), date(16, 13)), sleep('asleep', date(17, 11), date(17, 13))], { now: date(17, 18) });
  assert.equal(report.minutes, 120);
  assert.equal(report.recordedStart, date(16, 12));
  assert.equal(report.recordedEnd, date(17, 12));
  assert.deepEqual(report.segments, [
    { start: date(16, 12), end: date(16, 13), stage: 'asleep' },
    { start: date(17, 11), end: date(17, 12), stage: 'asleep' },
  ]);
});

test('没有窗口内睡眠或仅卧床数据时保持未知', () => {
  assert.equal(sleepReport([sleep('asleep', date(15, 22), date(16, 6))], { now }).minutes, null);
  assert.equal(sleepReport([sleep('inBed', date(16, 22), date(17, 7))], { now }).minutes, null);
  assert.equal(sleepReport([sleep('asleep', date(16, 22), date(17, 10))], { now }).minutes, null);
  assert.equal(sleepReport([sleep('invalid', date(16, 22), date(17, 7))], { now }).minutes, null);
  for (const records of [[], [sleep('inBed', date(16, 22), date(17, 7))]]) {
    const report = sleepReport(records, { now });
    assert.deepEqual(report.segments, []);
    assert.equal(report.recordedStart, null);
    assert.equal(report.recordedEnd, null);
  }
});

test('睡眠合并重复与重叠，分期覆盖概括睡眠，清醒覆盖冲突', () => {
  const base = sleep('asleep', date(16, 22), date(17, 6));
  const report = sleepReport([
    base, { ...base, id: 'duplicate' }, sleep('asleep', date(16, 23), date(17, 5)),
    sleep('core', date(16, 23), date(17, 3)),
    sleep('rem', date(17, 0), date(17, 2)),
    sleep('deep', date(17, 1), date(17, 3)),
    sleep('awake', date(17, 2, 30), date(17, 3, 30)),
    sleep('inBed', date(16, 21), date(17, 8)),
  ], { now });
  assert.equal(report.minutes, 420);
  assert.deepEqual(report.stages, { deep: 90, core: 60, rem: 60, asleep: 210, awake: 60 });
  assert.equal(Object.values(report.stages).reduce((a, b) => a + b, 0), 480);
  assert.equal(report.recordedStart, date(16, 22));
  assert.equal(report.recordedEnd, date(17, 6));
  assert.deepEqual(report.segments, [
    { start: date(16, 22), end: date(16, 23), stage: 'asleep' },
    { start: date(16, 23), end: date(17, 0), stage: 'core' },
    { start: date(17, 0), end: date(17, 1), stage: 'rem' },
    { start: date(17, 1), end: date(17, 2, 30), stage: 'deep' },
    { start: date(17, 2, 30), end: date(17, 3, 30), stage: 'awake' },
    { start: date(17, 3, 30), end: date(17, 6), stage: 'asleep' },
  ]);
});

test('每晚只选最近有效睡眠来源，床上记录不抢占睡眠设备', () => {
  const result = sleepReport([
    sleep('asleep', date(16, 22), date(17, 7), { source: 'Watch' }),
    sleep('asleep', date(16, 21), date(17, 6), { source: 'Phone' }),
    sleep('inBed', date(16, 21), date(17, 8), { source: 'Phone' }),
  ], { now });
  assert.equal(result.source, 'Watch');
  assert.equal(result.minutes, 540);
  assert.equal(result.recordedStart, date(16, 22));
  assert.deepEqual(result.segments, [{ start: date(16, 22), end: date(17, 7), stage: 'asleep' }]);
});

test('仅有清醒记录与完全无记录不同；相邻区间不重复计数', () => {
  const awake = sleepReport([sleep('awake', date(17, 1), date(17, 2))], { now });
  assert.equal(awake.minutes, 0);
  assert.equal(awake.recordedStart, date(17, 1));
  assert.equal(awake.recordedEnd, date(17, 2));
  assert.deepEqual(awake.segments, [{ start: date(17, 1), end: date(17, 2), stage: 'awake' }]);
  const result = sleepReport([sleep('core', date(17, 0), date(17, 1)), sleep('rem', date(17, 1), date(17, 2))], { now });
  assert.equal(result.minutes, 120);
  assert.equal(result.stages.core, 60);
  assert.equal(result.stages.rem, 60);
});

test('睡眠时间轴仅合并相邻同阶段，缺口保留且不改原记录', () => {
  const records = [sleep('core', date(17, 0), date(17, 1)), sleep('core', date(17, 1), date(17, 2)),
    sleep('core', date(17, 3), date(17, 4)), sleep('core', date(17, 3, 30), date(17, 5)),
    sleep('awake', date(16, 23, 50), date(17, 0)), sleep('awake', date(17, 5), date(17, 5, 10))];
  const original = structuredClone(records);
  const report = sleepReport(records, { now });
  assert.equal(report.minutes, 240);
  assert.equal(report.recordedStart, date(16, 23, 50));
  assert.equal(report.recordedEnd, date(17, 5, 10));
  assert.deepEqual(report.segments, [
    { start: date(16, 23, 50), end: date(17, 0), stage: 'awake' },
    { start: date(17, 0), end: date(17, 2), stage: 'core' },
    { start: date(17, 3), end: date(17, 5), stage: 'core' },
    { start: date(17, 5), end: date(17, 5, 10), stage: 'awake' },
  ]);
  assert.deepEqual(records, original);
});

test('历史睡眠使用完整中午窗口，缺失日期为 null，可保留更换设备前的历史', () => {
  const series = sleepSeries([
    sleep('asleep', date(15, 23), date(16, 11), { source: 'Old Watch' }),
    sleep('asleep', date(16, 23), date(17, 7), { source: 'New Watch' }),
  ], { now, days: 3 });
  assert.deepEqual(series.map(item => item.minutes), [null, 720, 480]);
  assert.deepEqual(series.map(item => item.day), ['2026-11-15', '2026-11-16', '2026-11-17']);
  assert.deepEqual(series.map(item => item.at), [date(15), date(16), date(17)]);
  assert.deepEqual(series.map(item => item.source), [null, 'Old Watch', 'New Watch']);
  assert.deepEqual(series.map(item => item.recordedStart), [null, date(15, 23), date(16, 23)]);
  assert.deepEqual(series.map(item => item.recordedEnd), [null, date(16, 11), date(17, 7)]);
  assert.deepEqual(series.map(item => item.window), [
    { start: date(14, 12), end: date(15, 12) },
    { start: date(15, 12), end: date(16, 12) },
    { start: date(16, 12), end: now },
  ]);
  assert.deepEqual(series.map(item => item.segments), [[],
    [{ start: date(15, 23), end: date(16, 11), stage: 'asleep' }],
    [{ start: date(16, 23), end: date(17, 7), stage: 'asleep' }],
  ]);
});

test('活动合计同来源且精确去重，不累加另一设备', () => {
  const first = sample('steps', 500, date(17, 8), { start: date(17, 7), source: 'Watch' });
  const result = analyze([first, { ...first, id: 'new-id' },
    sample('steps', 700, date(17, 9), { start: date(17, 8), source: 'Watch' }),
    sample('steps', 900, date(17, 8, 30), { start: date(17, 7), source: 'Phone' }),
    sample('activeEnergy', 100, date(17, 8), { source: 'Other' }),
    sample('activeEnergy', 40, date(17, 9), { source: 'Watch' }),
  ], { now });
  assert.equal(result.activity.steps, 1200);
  assert.equal(result.activity.energy, 40);
});

test('活动不猜测跨午夜样本，零值合法，昨日和未来不混入', () => {
  const result = analyze([
    sample('steps', 100, date(17, 1), { start: date(16, 23) }),
    sample('steps', 200, date(16, 23)), sample('steps', 300, date(17, 10)),
    sample('steps', 0, date(17, 8)), sample('activeEnergy', 0, date(17, 8)),
  ], { now });
  assert.equal(result.activity.steps, 0);
  assert.equal(result.activity.energy, 0);
  assert.equal(analyze([sample('steps', 100, date(17, 1), { start: date(16, 23) })], { now }).activity.steps, null);
});

test('每日趋势保留空日，只使用选定来源每日中位数', () => {
  const records = [sample('hrv', 20, date(15, 6)), sample('hrv', 40, date(15, 8)),
    sample('hrv', 900, date(16, 8), { source: 'Other' }), sample('hrv', 50)];
  const series = dailySeries(records, 'hrv', { now, days: 3 });
  assert.deepEqual(series, [
    { day: '2026-11-15', at: date(15), value: 30, source: 'Apple Watch' },
    { day: '2026-11-16', at: date(16), value: null, source: null },
    { day: '2026-11-17', at: date(17), value: 50, source: 'Apple Watch' },
  ]);
  assert.deepEqual(dailySeries(records, 'hrv', { now, days: 3, source: 'Other' }).map(item => item.value), [null, 900, null]);
});

test('HRV 手动来源不限制其他趋势，活动各日独立选择单一来源', () => {
  const records = [sample('heartRate', 65),
    sample('steps', 100, date(16, 8), { source: 'Old Watch' }),
    sample('steps', 300, date(17, 8), { source: 'New Watch' }),
    sample('steps', 900, date(17, 7), { source: 'Phone' })];
  assert.deepEqual(dailySeries(records, 'heartRate', { now, days: 2, source: 'Missing' }).map(item => item.value), [null, 65]);
  assert.deepEqual(dailySeries(records, 'steps', { now, days: 2, source: 'Missing' }).map(item => item.value), [100, 300]);
  assert.deepEqual(dailySeries(records, 'steps', { now, days: 2 }).map(item => item.source), ['Old Watch', 'New Watch']);
});

test('个人分档按同源每日中位数建档，少于七天不生成区间', () => {
  const records = [...history([10, 20, 30, 40, 50, 60, 70]), sample('hrv', 1000),
    ...history([500, 500, 500, 500, 500, 500, 500]).map(r => ({ ...r, source: 'Phone' }))];
  records.push(sample('hrv', 10, date(16, 7)));
  const bands = personalBands(records, { now });
  assert.deepEqual(bands.get(JSON.stringify(['hrv', 'Apple Watch'])), { type: 'hrv', source: 'Apple Watch', days: 7, lower: 25, upper: 55 });
  assert.equal(bands.get(JSON.stringify(['hrv', 'Phone'])).lower, 500);
  const six = personalBands(history([10, 20, 30, 40, 50, 60]), { now }).get(JSON.stringify(['hrv', 'Apple Watch']));
  assert.deepEqual([six.days, six.lower, six.upper], [6, null, null]);
});

test('个人分档包含第28日，排除今天、未来与第29日，不合并特殊来源名', () => {
  const records = [...history([10, 20, 30, 40, 50, 60, 70]), sample('hrv', 80, date(-11, 8)),
    sample('hrv', 999, date(-12, 8)), sample('hrv', 999, now), sample('hrv', 999, now + 1),
    sample('heartRate', 60, date(16, 8), { source: '__proto__' }),
    sample('heartRate', 61, date(16, 8), { source: 'constructor' }), null];
  const bands = personalBands(records, { now });
  assert.deepEqual(bands.get(JSON.stringify(['hrv', 'Apple Watch'])), { type: 'hrv', source: 'Apple Watch', days: 8, lower: 27.5, upper: 62.5 });
  assert.equal(bands.get(JSON.stringify(['heartRate', '__proto__'])).days, 1);
  assert.equal(bands.get(JSON.stringify(['heartRate', 'constructor'])).days, 1);
  assert.deepEqual(personalBands([...records].reverse(), { now }), bands);
});

test('活动分档用同源日合计，重复去除、跨日不猜测且合计溢出日不计覆盖', () => {
  const records = [];
  for (let day = 10; day <= 16; day++) {
    records.push(sample('steps', 100, date(day, 8)), sample('steps', 100, date(day, 9)),
      sample('steps', 900, date(day, 10), { source: 'Phone' }),
      sample('activeEnergy', 0, date(day, 8)));
  }
  records.push({ ...records[0], id: 'repeat' }, sample('steps', 999, date(16, 1), { start: date(15, 23) }),
    sample('steps', Number.MAX_VALUE, date(9, 8)), sample('steps', Number.MAX_VALUE, date(9, 9)));
  const bands = personalBands(records, { now });
  const steps = bands.get(JSON.stringify(['steps', 'Apple Watch']));
  assert.deepEqual([steps.days, steps.lower, steps.upper], [7, 200, 200]);
  const energy = bands.get(JSON.stringify(['activeEnergy', 'Apple Watch']));
  assert.deepEqual([energy.days, energy.lower, energy.upper], [7, 0, 0]);
  assert.equal(relativeLevel(0, energy), 'usual');
  assert.equal(bands.get(JSON.stringify(['steps', 'Phone'])).lower, 900);
});

test('睡眠分档用此前完整同源窗口，合并重叠并排除当前睡眠', () => {
  const records = [];
  for (let day = 9; day <= 15; day++) {
    records.push(sleep('core', date(day, 23), date(day + 1, 7)),
      sleep('deep', date(day, 23), date(day + 1, 1)),
      sleep('asleep', date(day, 22), date(day + 1, 7), { source: 'Phone' }));
  }
  records.push(sleep('core', date(16, 23), date(17, 2)), sleep('inBed', date(8, 22), date(9, 7)));
  const bands = personalBands(records, { now });
  const watch = bands.get(JSON.stringify(['sleep', 'Apple Watch']));
  assert.deepEqual([watch.days, watch.lower, watch.upper], [7, 480, 480]);
  assert.equal(bands.get(JSON.stringify(['sleep', 'Phone'])).lower, 540);
});

test('相对分级优先区分缺失、过时和基线不足，边界内归常见范围', () => {
  const band = { days: 7, lower: 10, upper: 20 };
  for (const value of [null, undefined, NaN, Infinity, '15']) assert.equal(relativeLevel(value, band, { stale: true }), 'noData');
  assert.equal(relativeLevel(0, undefined, { stale: true }), 'stale');
  for (const invalid of [undefined, {}, { ...band, days: 6 }, { ...band, days: 7.1 },
    { ...band, lower: null }, { ...band, lower: Infinity }, { ...band, upper: NaN }, { ...band, lower: 21 }]) {
    assert.equal(relativeLevel(15, invalid), 'building');
  }
  assert.equal(relativeLevel(0, band), 'below');
  assert.equal(relativeLevel(10, band), 'usual');
  assert.equal(relativeLevel(20, band), 'usual');
  assert.equal(relativeLevel(21, band), 'above');
});

test('个人分档不修改输入，没有可分析记录时空 Map，非法时间拒绝', () => {
  const records = Object.freeze([Object.freeze(sample('heartRate', 60))]);
  const before = structuredClone(records);
  const band = personalBands(records, { now }).get(JSON.stringify(['heartRate', 'Apple Watch']));
  assert.deepEqual([band.days, band.lower, band.upper], [0, null, null]);
  assert.deepEqual(records, before);
  assert.equal(personalBands([], { now }).size, 0);
  assert.equal(personalBands([sample('hrv', -1), sample('heartRate', NaN)], { now }).size, 0);
  assert.throws(() => personalBands([], { now: Infinity }), RangeError);
});

test('午夜测量归新日，结束于午夜的活动区间归此前开始的完整自然日', () => {
  const heart = dailySeries([sample('heartRate', 65, date(17))], 'heartRate', { now, days: 2 });
  assert.deepEqual(heart.map(item => item.value), [null, 65]);
  const steps = dailySeries([
    sample('steps', 100, date(17), { start: date(16, 23) }),
    sample('steps', 200, date(17)), sample('steps', 300, date(17, 1)),
  ], 'steps', { now, days: 2 });
  assert.deepEqual(steps.map(item => item.value), [100, 500]);
});

test('日历窗口跨月跨年正确，输入顺序不影响选择与结果', () => {
  const january = new Date(2027, 0, 1, 9).getTime();
  assert.deepEqual(dailySeries([], 'hrv', { now: january, days: 3 }).map(item => item.day), ['2026-12-30', '2026-12-31', '2027-01-01']);
  const records = [sample('hrv', 50, now, { source: 'A' }), sample('hrv', 70, now, { source: 'B' }),
    sleep('core', date(17, 1), date(17, 3)), sleep('deep', date(17, 2), date(17, 4))];
  assert.deepEqual(analyze(records, { now }), analyze([...records].reverse(), { now }));
});

test('日周月使用自然日、周一和自然月；当前周期截断在现在', () => {
  const day = calendarPeriod('day', null, now);
  assert.deepEqual(day, { period: 'day', start: date(17), end: date(18), through: now,
    days: 1, previous: date(16), next: null, isCurrent: true });
  const week = calendarPeriod('week', null, now);
  assert.deepEqual(week, { period: 'week', start: date(16), end: date(23), through: now,
    days: 2, previous: date(9), next: null, isCurrent: true });
  const month = calendarPeriod('month', null, now);
  assert.equal(month.start, date(1));
  assert.equal(month.end, date(31));
  assert.equal(month.days, 17);
  assert.equal(month.through, now);
  assert.equal(month.previous, +new Date(2026, 9, 1));
  assert.equal(month.next, null);
  assert.deepEqual(dailySeries([], 'hrv', { days: week.days, now: week.through }).map(item => item.at), [date(16), date(17)]);
});

test('历史周期支持跨年、闰月和月末切换，不纳入下一周期记录', () => {
  const januaryNow = +new Date(2027, 0, 1, 9);
  const week = calendarPeriod('week', +new Date(2026, 11, 31), januaryNow);
  assert.equal(week.start, +new Date(2026, 11, 28));
  assert.equal(week.end, +new Date(2027, 0, 4));
  assert.equal(week.days, 5);
  const october = calendarPeriod('month', +new Date(2026, 9, 31), now);
  assert.equal(october.days, 31);
  assert.equal(october.previous, +new Date(2026, 8, 1));
  assert.equal(october.next, date(1));
  assert.equal(october.through, date(1) - 1);
  assert.equal(october.isCurrent, false);
  const february = calendarPeriod('month', +new Date(2028, 1, 29), +new Date(2028, 2, 31));
  assert.equal(february.days, 29);
  assert.equal(february.previous, +new Date(2028, 0, 1));
  assert.equal(february.next, +new Date(2028, 2, 1));
  const yesterday = calendarPeriod('day', date(16, 12), now);
  assert.equal(yesterday.through, date(17) - 1);
  assert.equal(yesterday.next, date(17));
  assert.deepEqual(hourlySeries([sample('hrv', 40, date(16, 23, 59)), sample('hrv', 90, date(17))], 'hrv', { now: yesterday.through })
    .filter(point => point.value !== null).map(point => point.value), [40]);
});

test('周期参数必须是已到达的有效时间，非法范围明确失败', () => {
  for (const anchor of [NaN, Infinity, '2026-11-17', now + 1]) assert.throws(() => calendarPeriod('day', anchor, now), RangeError);
  assert.throws(() => calendarPeriod('year', null, now), RangeError);
  assert.throws(() => calendarPeriod('day', null, NaN), RangeError);
  assert.throws(() => calendarPeriod('month', null, 8640000000000000), RangeError);
});

test('小时趋势保留缺失、过滤未来和重复数据，使用同来源小时中位数', () => {
  const record = Object.freeze(sample('hrv', 40, date(17, 8, 10)));
  const records = Object.freeze([record, { ...record, id: 'again' }, sample('hrv', 60, date(17, 8, 20)),
    sample('hrv', 1000, date(17, 8, 30), { source: 'Other' }), sample('hrv', 80, now),
    sample('hrv', 120, now + 1), sample('hrv', 70, date(16, 23)), sample('hrv', NaN)]);
  const series = hourlySeries(records, 'hrv', { now });
  assert.equal(series.length, 10);
  assert.deepEqual(series[0], { at: date(17), day: '00:00', value: null, source: null });
  assert.deepEqual(series.slice(-2).map(point => [point.day, point.value, point.source]), [['08:00', 50, 'Apple Watch'], ['09:00', 80, 'Apple Watch']]);
  assert.deepEqual(hourlySeries(records, 'hrv', { now, source: 'Other' }).slice(-2).map(point => point.value), [1000, null]);
  assert.ok(hourlySeries(records, 'hrv', { now, source: 'Missing' }).every(point => point.value === null));
  assert.deepEqual(hourlySeries(records, 'hrv', { now }), hourlySeries([...records].reverse(), 'hrv', { now }));
  assert.throws(() => hourlySeries(records, 'sleep', { now }), RangeError);
  assert.throws(() => hourlySeries(records, 'hrv', { now: NaN }), RangeError);
});

test('小时活动沿用当日来源，跨小时样本不摊分，边界和零值保留', () => {
  const records = [sample('steps', 800, date(17, 7, 40), { source: 'Phone' }),
    sample('steps', 100, date(17, 8), { start: date(17, 7, 30) }),
    sample('steps', 200, date(17, 8)), sample('steps', 0, date(17, 8, 10)),
    sample('steps', 500, date(17, 8, 20), { start: date(17, 7, 50) }),
    sample('steps', 0, now)];
  const series = hourlySeries(records, 'steps', { now, source: 'Missing' });
  assert.deepEqual(series.slice(7).map(point => [point.value, point.source]), [[100, 'Apple Watch'], [200, 'Apple Watch'], [0, 'Apple Watch']]);
  assert.equal(dailySeries(records, 'steps', { days: 1, now })[0].value, 800);
  const heart = hourlySeries([sample('heartRate', 60, now)], 'heartRate', { now, source: 'Missing' });
  assert.equal(heart.at(-1).value, 60);
});

test('周期日数和小时桶处理 DST 春季缺时、秋季重复小时', () => {
  const moduleUrl = new URL('../core.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { calendarPeriod, hourlySeries } from ${JSON.stringify(moduleUrl)};
    const springNow = +new Date(2026, 2, 9, 9);
    const spring = calendarPeriod('day', +new Date(2026, 2, 8), springNow);
    assert.equal(spring.days, 1);
    assert.equal(spring.end - spring.start, 23 * 60 * 60 * 1000);
    const springHours = hourlySeries([], 'hrv', { now: spring.through });
    assert.equal(springHours.length, 23);
    assert.equal(springHours.some(point => point.day === '02:00'), false);
    const springWeek = calendarPeriod('week', +new Date(2026, 2, 8), springNow);
    assert.equal(springWeek.days, 7);
    const fall = calendarPeriod('day', +new Date(2026, 10, 1), +new Date(2026, 10, 2, 9));
    assert.equal(fall.days, 1);
    assert.equal(fall.end - fall.start, 25 * 60 * 60 * 1000);
    const fallHours = hourlySeries([], 'hrv', { now: fall.through });
    assert.equal(fallHours.length, 25);
    const repeated = fallHours.filter(point => point.day === '01:00');
    assert.equal(repeated.length, 2);
    assert.equal(repeated[1].at - repeated[0].at, 60 * 60 * 1000);
    assert.equal(calendarPeriod('month', +new Date(2026, 10, 1), +new Date(2026, 11, 1)).days, 30);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { TZ: 'America/New_York' }, stdio: 'pipe' });
});

test('DST 切换仍按当地自然日和中午计算，不假设一天固定 24 小时', () => {
  // 独立进程仅设置测试所需时区，不读取或复制宿主环境变量。
  const moduleUrl = new URL('../core.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { dailySeries, sleepWindow } from ${JSON.stringify(moduleUrl)};
    const spring = dailySeries([], 'hrv', { now: new Date(2026, 2, 9, 9).getTime(), days: 3 });
    assert.deepEqual(spring.map(item => item.day), ['2026-03-07', '2026-03-08', '2026-03-09']);
    assert.equal(spring[2].at - spring[1].at, 23 * 60 * 60 * 1000);
    const springSleep = sleepWindow(new Date(2026, 2, 8, 13).getTime());
    assert.equal(springSleep.end - springSleep.start, 23 * 60 * 60 * 1000);
    const fall = dailySeries([], 'hrv', { now: new Date(2026, 10, 2, 9).getTime(), days: 2 });
    assert.equal(fall[1].at - fall[0].at, 25 * 60 * 60 * 1000);
    const fallSleep = sleepWindow(new Date(2026, 10, 1, 13).getTime());
    assert.equal(fallSleep.end - fallSleep.start, 25 * 60 * 60 * 1000);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { TZ: 'America/New_York' }, stdio: 'pipe' });
});

test('纯函数不修改输入，统计参数错误显式失败', () => {
  const record = Object.freeze(sample('hrv', 50));
  const records = Object.freeze([record]);
  analyze(records, { now });
  dailySeries(records, 'hrv', { now });
  sleepSeries(records, { now });
  assert.equal(median([3, 1, 2, Number.NaN]), 2);
  assert.equal(median([]), null);
  assert.throws(() => analyze([], { now: Number.NaN }), RangeError);
  assert.throws(() => dailySeries([], 'hrv', { days: 0 }), RangeError);
  assert.throws(() => sleepSeries([], { days: 1.5 }), RangeError);
  assert.throws(() => dailySeries([], 'sleep'), RangeError);
});

test('恢复观察空值保持未知，非法和未来数据不能生成状态', () => {
  const records = [null, sample('hrv', 80, now + 1), sample('restingHeartRate', -1),
    sample('oxygenSaturation', Infinity), sleep('inBed', date(16, 23), date(17, 7))];
  const report = recoveryReport(records, { now });
  assert.deepEqual(report.signals.map(signal => signal.type), ['hrv', 'restingHeartRate', 'sleep', 'respiratoryRate', 'oxygenSaturation']);
  for (const signal of report.signals) {
    assert.equal(signal.level, 'noData');
    for (const key of ['value', 'baseline', 'lower', 'upper', 'source', 'recordedEnd']) assert.equal(signal[key], null);
    assert.equal(signal.days, 0);
  }
});

test('恢复观察使用今日中位数、过去28日每日中位数和七日门槛', () => {
  const previous = [10, 20, 30, 40, 50, 60, 70].map((value, index) => sample('hrv', value, date(16 - index, 8)));
  const today = [sample('hrv', 25, date(17, 7)), sample('hrv', 35, date(17, 8)), sample('hrv', 300, now)];
  const [result] = recoveryReport([...previous, ...today, sample('hrv', 999, date(-12, 8))], { now }).signals;
  assert.equal(result.value, 35);
  assert.equal(result.days, 7);
  assert.equal(result.baseline, 40);
  assert.equal(result.lower, 25);
  assert.equal(result.upper, 55);
  assert.equal(result.level, 'usual');
  assert.equal(result.recordedEnd, now);
  const [six] = recoveryReport([...previous.slice(1), ...today], { now }).signals;
  assert.equal(six.level, 'building');
  assert.equal(six.baseline, null);
  assert.equal(recoveryReport([...previous, sample('hrv', 24)], { now }).signals[0].level, 'below');
  assert.equal(recoveryReport([...previous, sample('hrv', 56)], { now }).signals[0].level, 'above');
});

test('恢复观察同日测量密度不改变历史日权重，精确重复不改变今日值', () => {
  const previous = history([10, 20, 30, 40, 50, 60, 70]);
  previous.push(sample('hrv', 50, date(16, 7))); // 首日中位数变成30，各日仍只占一份权重。
  const low = sample('hrv', 20, date(17, 8));
  const [result] = recoveryReport([...previous, low, { ...low, id: 'duplicate' }, sample('hrv', 80)], { now }).signals;
  assert.equal(result.value, 50);
  assert.equal(result.baseline, 40);
  assert.equal(result.lower, 30);
  assert.equal(result.days, 7);
});

test('恢复观察分别选来源，手动 HRV 来源不影响其他指标，旧样本明确过时', () => {
  const records = [sample('hrv', 40, date(16, 8), { source: 'A' }), sample('hrv', 60, now, { source: 'B' }),
    sample('restingHeartRate', 55, now, { source: 'B' }), sample('respiratoryRate', 14, date(16, 8)),
    sample('oxygenSaturation', 98, now)];
  const { signals } = recoveryReport(records, { now, source: 'A' });
  assert.equal(signals[0].value, 40);
  assert.equal(signals[0].source, 'A');
  assert.equal(signals[0].level, 'stale');
  assert.equal(signals[1].source, 'B');
  assert.equal(signals[1].value, 55);
  assert.equal(signals[3].level, 'stale');
  assert.equal(signals[4].level, 'building');
  assert.equal(recoveryReport(records, { now, source: 'Missing' }).signals[0].level, 'noData');
  assert.deepEqual(recoveryReport(records, { now }), recoveryReport([...records].reverse(), { now }));
});

test('恢复睡眠以同来源完整中午窗口为基线，不混入本窗口或其他设备', () => {
  const previous = Array.from({ length: 7 }, (_, index) => sleep('core', date(9 + index, 23), date(10 + index, 7)));
  const records = [...previous, sleep('deep', date(16, 23), date(17, 4)),
    sleep('core', date(17, 3), date(17, 6)), // 重叠仍共7小时
    sleep('asleep', date(15, 20), date(16, 9), { source: 'Phone' })];
  const result = recoveryReport(records, { now }).signals[2];
  assert.equal(result.value, 420);
  assert.equal(result.days, 7);
  assert.equal(result.baseline, 480);
  assert.equal(result.lower, 480);
  assert.equal(result.level, 'below');
  assert.equal(result.source, 'Apple Watch');
  assert.equal(result.recordedEnd, date(17, 6));
});

test('没有当前睡眠时展示此前窗口并标记旧数据，不挪用当日下午睡眠', () => {
  const records = [sleep('core', date(15, 23), date(16, 7)), sleep('core', date(17, 13), date(17, 14))];
  const afternoon = date(17, 15);
  const result = recoveryReport(records, { now: afternoon }).signals[2];
  assert.equal(result.value, 480);
  assert.equal(result.level, 'stale');
  assert.equal(result.recordedEnd, date(16, 7));
  assert.equal(recoveryReport([records[1]], { now: afternoon }).signals[2].level, 'noData');
  const noonEnd = recoveryReport([sleep('core', date(16, 11), date(16, 12))], { now }).signals[2];
  assert.equal(noonEnd.value, 60);
  assert.equal(noonEnd.level, 'stale');
});

const workout = (start, end, options = {}) => sample('workout', 'HKWorkoutActivityTypeWalking', end, { start, ...options });

test('训练空态无数据不当零，过滤未来、倒置、无效记录和窗口前开始的训练', () => {
  const records = [workout(date(17, 8), now + 1), workout(now, now - 1), workout(now, now),
    workout(date(16, 23), date(17, 1)), workout(date(17, 7), date(17, 8), { value: '' })];
  const result = workoutReport(records, { now, days: 1 });
  assert.equal(result.source, null);
  assert.equal(result.count, 0);
  assert.equal(result.minutes, null);
  assert.equal(result.activeDays, 0);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.daily, [{ day: '2026-11-17', at: date(17), minutes: null, count: 0 }]);
});

test('训练单来源精确去重；总时长合并重叠，不把记录条数当独立运动次数', () => {
  const first = workout(date(17, 7), date(17, 8));
  const records = [first, { ...first, id: 'repeat' }, workout(date(17, 7, 30), date(17, 8, 30)),
    workout(date(17, 6), date(17, 8), { source: 'Phone' })];
  const result = workoutReport(records, { now, days: 2 });
  assert.equal(result.source, 'Apple Watch');
  assert.equal(result.count, 2);
  assert.equal(result.minutes, 90);
  assert.equal(result.activeDays, 1);
  assert.deepEqual(result.items.map(item => item.duration), [60, 60]);
  assert.deepEqual(result.daily.map(day => [day.minutes, day.count]), [[null, 0], [90, 2]]);
  const reversed = workoutReport([...records].reverse(), { now, days: 2 });
  // 输入 id 不参与健康样本身份；去重后可能保留任一导入批次的 id。
  const withoutIds = report => ({ ...report, items: report.items.map(({ id, ...item }) => item) });
  assert.deepEqual(withoutIds(result), withoutIds(reversed));
});

test('训练跨日拆分时长、开始日归属记录数，午夜结束不占用下一天', () => {
  const records = [workout(date(15, 23), date(16)), workout(date(16, 23, 30), date(17, 0, 30))];
  const result = workoutReport(records, { now, days: 3 });
  assert.equal(result.minutes, 120);
  assert.equal(result.activeDays, 3);
  assert.deepEqual(result.daily.map(day => [day.minutes, day.count]), [[60, 1], [30, 1], [30, 0]]);
});

test('训练心率只取同来源且完整位于训练内的离散样本，不填补缺失', () => {
  const records = [workout(date(17, 7), date(17, 8)), workout(date(17, 8, 30), now),
    sample('heartRate', 80, date(17, 7)), sample('heartRate', 100, date(17, 7, 30)), sample('heartRate', 90, date(17, 8)),
    sample('heartRate', 200, date(17, 7, 30), { source: 'Phone' }),
    sample('heartRate', 180, date(17, 7, 30), { start: date(17, 6, 30) }),
    sample('heartRate', 190, date(17, 8, 1))];
  const { items } = workoutReport(records, { now });
  assert.deepEqual(items[0].heartRate, { count: 0, median: null, min: null, max: null });
  assert.deepEqual(items[1].heartRate, { count: 3, median: 90, min: 80, max: 100 });
});

test('恢复与训练保持输入不变，拒绝无效统计参数', () => {
  const record = Object.freeze(workout(date(17, 7), date(17, 8)));
  const records = Object.freeze([record]);
  recoveryReport(records, { now });
  workoutReport(records, { now });
  assert.equal(Object.hasOwn(record, 'duration'), false);
  assert.throws(() => recoveryReport([], { now: NaN }), RangeError);
  assert.throws(() => workoutReport([], { now: Infinity }), RangeError);
  assert.throws(() => workoutReport([], { days: 0 }), RangeError);
  assert.throws(() => workoutReport([], { days: 1.5 }), RangeError);
});

test('跨 DST 的训练按实际经过分钟和当地日历分配', () => {
  const moduleUrl = new URL('../core.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { workoutReport } from ${JSON.stringify(moduleUrl)};
    const start = +new Date(2026, 2, 7, 23), end = +new Date(2026, 2, 8, 4);
    const record = { type: 'workout', value: 'Walking', unit: 'min', source: 'Watch', start, end };
    const result = workoutReport([record], { now: +new Date(2026, 2, 8, 10), days: 2 });
    assert.equal(result.minutes, 240);
    assert.deepEqual(result.daily.map(day => day.minutes), [60, 180]);
    assert.deepEqual(result.daily.map(day => day.day), ['2026-03-07', '2026-03-08']);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { TZ: 'America/New_York' }, stdio: 'pipe' });
});
