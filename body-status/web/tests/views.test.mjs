import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApp, renderEntryGrade, renderEntryOptions } from '../views.mjs';
import { analyze, dailySeries, hourlySeries, calendarPeriod, sleepSeries, recoveryReport, workoutReport, personalBands } from '../core.mjs';
import { journalReport } from '../model.mjs';
import { demoData } from '../demo.mjs';

const now = new Date(2026, 10, 17, 12).getTime();
function stateFor(view = 'overview', records = [], journal = [], { period = 'month', periodAnchor = null, at = now, metric = 'hrv' } = {}) {
  const window = calendarPeriod(period, periodAnchor, at);
  const options = { now: window.through, days: window.days };
  return {
    view, mode: 'real', records, journal, now: at, source: 'auto', period, periodAnchor, window, metric,
    analysis: analyze(records, { now: at }), series: period === 'day' ? hourlySeries(records, metric, options) : dailySeries(records, metric, options),
    sleeps: sleepSeries(records, options), sources: [...new Set(records.filter(r => r.type === 'hrv').map(r => r.source))],
    recovery: recoveryReport(records, { now: at }), workouts: workoutReport(records, options),
    journalReport: journalReport(journal, options),
    reviewHrv: dailySeries(records, 'hrv', options), reviewSleep: sleepSeries(records, options),
    bands: personalBands(records, { now: at }),
    importStatus: null, importPreview: null, notice: '', storageReady: true,
    storageError: '', lastImport: null, breathing: { running: false, elapsed: 0 },
  };
}

function nativeState(view = 'overview', records = [], changes = {}) {
  const state = stateFor(view, records);
  state.native = { available: true, accessRequested: false, isLoading: false, lastLoadedAt: null,
    historyStart: null, message: null, backgroundMessage: null, records, ...changes };
  state.nativeBusy = false;
  return state;
}

test('原生首次使用以系统健康授权为入口，Web 仍保留文件导入', () => {
  const native = renderApp(nativeState());
  assert.match(native, /data-action="health-connect"[^>]*>连接 Apple 健康/);
  assert.match(native, /选择允许读取的指标/); assert.match(native, /无需另装手表 App/);
  assert.match(native, /最近 90 天/); assert.match(native, /非连续实时监测/);
  assert.ok(native.indexOf('id="health-connection-title"') < native.indexOf('id="daily-summary-title"'), '首次连接入口先于空总结');
  assert.doesNotMatch(native, /data-action="import-open"|data-action="health-refresh"|已获授权|授权成功|永久授权/);
  const web = renderApp(stateFor());
  assert.match(web, /data-action="import-open"/); assert.match(web, /导入 Apple 健康文件/);
  assert.doesNotMatch(web, /data-action="health-(?:connect|refresh|settings)"/);
});

test('原生完成授权面板但没有数据时不推断已授权或健康正常', () => {
  const html = renderApp(nativeState('overview', [], { accessRequested: true, lastLoadedAt: now }));
  assert.match(html, /还没有读到可用记录/); assert.match(html, /未允许读取/);
  assert.match(html, /data-action="health-refresh"/); assert.match(html, /data-action="health-connect"[^>]*>检查读取范围/);
  assert.match(html, /data-action="health-settings"/); assert.match(html, /今日数据 0 \/ 3/);
  assert.doesNotMatch(html, /已获授权|授权成功|今日接近日常|数据已同步完成/);
});

test('原生数据覆盖区分本机读取与实际测量时间，并说明权限和本机数据边界', () => {
  const sampled = now - 3_600_000;
  const records = [{ type: 'hrv', value: 42, start: sampled, end: sampled, source: 'Apple Watch', unit: 'ms' }];
  const html = renderApp(nativeState('data', records, { accessRequested: true, lastLoadedAt: now, historyStart: now - 90 * 86_400_000 }));
  const coverage = html.match(/<section class="coverage-panel">[\s\S]*?<\/section>/)[0];
  assert.match(coverage, /1 \/ 9 类/); assert.equal((coverage.match(/class="coverage-link"/g) || []).length, 9);
  assert.match(coverage, /上次读取/); assert.match(coverage, /12:00/); assert.match(coverage, /最近 [^<]*11:00/);
  assert.match(coverage, /读取时间不等于测量时间/);
  assert.match(html, /按指标选择读取权限/); assert.match(html, /修改或撤回/);
  assert.match(html, /不自动写入网页数据库或上传/);
  assert.match(html, /当前健康快照与日常记录/); assert.match(html, /导入日常记录备份/);
  assert.match(html, /只合并心情、饮水、咖啡因和文字记录/);
  assert.match(html, /不会删除 Apple 健康原始记录/);
  assert.doesNotMatch(html, /不会自动从 Apple Watch 同步|导出完整备份|Safari 与主屏幕/);
});

test('原生读取等待或不可用时禁用读取按钮，保留演示入口', () => {
  for (const changes of [{ isLoading: true }, { available: false }]) {
    const html = renderApp(nativeState('data', [], changes));
    const actions = [...html.matchAll(/<button\b[^>]*data-action="health-(?:connect|refresh)"[^>]*>/g)].map(m => m[0]);
    assert.ok(actions.length > 0);
    for (const action of actions) assert.match(action, /\bdisabled\b/);
    assert.match(html, /data-action="demo-start"/);
    if (changes.isLoading) assert.match(html, /aria-busy="true"/);
    else assert.match(html, /此设备暂不可用/);
  }
  const state = nativeState(); state.nativeBusy = true;
  assert.match(renderApp(state), /data-action="health-connect" disabled aria-busy="true"/);
});

test('原生错误按文本转义，后台不可用保留温和提示，演示不显示真实读取状态', () => {
  const state = nativeState('data', [], { accessRequested: true, lastLoadedAt: now, historyStart: now - 90 * 86_400_000,
    message: '<img src=x>心率读取失败', backgroundMessage: '后台更新暂不可用' });
  let html = renderApp(state);
  assert.match(html, /&lt;img src=x&gt;心率读取失败/); assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /后台更新暂不可用/);
  state.native.error = '<script>桥接失败';
  html = renderApp(state);
  assert.match(html, /&lt;script&gt;桥接失败/); assert.doesNotMatch(html, /<script>/);
  state.mode = 'demo';
  html = renderApp(state);
  assert.match(html, /data-action="demo-exit"[^>]*>返回个人数据/);
  assert.match(html, /演示数值与 Apple 健康分开/);
  assert.doesNotMatch(html, /桥接失败|心率读取失败|后台更新暂不可用|data-action="health-connect"|data-action="health-refresh"|12:00/);
});

test('原生备份预览明确健康记录不导入，Web 仍说明健康记录合并', () => {
  const preview = { stats: { accepted: 10, duplicates: 1, skipped: 0, sources: ['Watch'] }, journal: [{ id: 'one' }] };
  const state = nativeState('data'); state.importPreview = preview;
  const native = renderApp(state).match(/<section class="import-panel"[\s\S]*?<\/section>/)[0];
  assert.match(native, /条文件内健康记录（不导入）/); assert.match(native, /确认后只合并日常记录/);
  state.native = null;
  const web = renderApp(state).match(/<section class="import-panel"[\s\S]*?<\/section>/)[0];
  assert.match(web, /相同健康记录只保留一份/); assert.doesNotMatch(web, /不导入/);
});

test('首页首屏以今日综合总结开场，单次 HRV 留在折叠详情', () => {
  const html = renderApp(stateFor());
  assert.match(html.match(/<main\b[\s\S]*?<section\b[^>]*>/)[0], /<section class="daily-summary"/);
  const summary = html.match(/<section class="daily-summary"[\s\S]*?<\/section>/)[0];
  assert.match(summary, /今日状态/); assert.match(summary, /等待今天的记录/);
  assert.match(summary, /data-tone="unknown"/); assert.match(summary, /今日数据 0 \/ 3 · 可比较 0 \/ 3/);
  assert.equal((summary.match(/class="daily-summary-signal"/g) || []).length, 3);
  assert.equal((summary.match(/<strong>—<\/strong>/g) || []).length, 3);
  assert.match(summary, /非实时监测/); assert.doesNotMatch(summary, /data-tone="positive"|signal-card/);
  const detailStart = html.indexOf('<details class="help-details" id="recent-hrv">');
  assert.ok(detailStart > html.indexOf('class="daily-summary"'));
  assert.ok(html.indexOf('<section class="signal-card"') > detailStart);
  assert.doesNotMatch(html.slice(detailStart, html.indexOf('>', detailStart)), /\bopen\b/);
});

test('首页三项齐全才显示积极总结，偏低 HRV 为温和关怀，午前睡眠为未完窗口', () => {
  const records = [];
  for (let day = 10; day <= 17; day++) {
    const end = +new Date(2026, 10, day, 8);
    for (const type of ['hrv', 'restingHeartRate', 'sleep']) records.push({ type,
      value: type === 'sleep' ? 'asleep' : 50, start: type === 'sleep' ? end - 480 * 60_000 : end,
      end, source: 'Watch', unit: type === 'hrv' ? 'ms' : type === 'sleep' ? 'min' : 'bpm' });
  }
  const summaryFor = (data, at = now) => renderApp(stateFor('overview', data, [], { at }))
    .match(/<section class="daily-summary"[\s\S]*?<\/section>/)[0];
  const positive = summaryFor(records);
  assert.match(positive, /data-tone="positive"/); assert.match(positive, /今日接近日常/);
  assert.match(positive, /今日数据 3 \/ 3 · 可比较 3 \/ 3/);
  const careRecords = records.map(record => record.type === 'hrv' && new Date(record.end).getDate() === 17 ? { ...record, value: 20 } : record);
  const care = summaryFor(careRecords);
  assert.match(care, /data-tone="care"/); assert.match(care, /给恢复留点空间/);
  assert.match(care, /1 项值得温和关照/); assert.doesNotMatch(care, /危险|警报|压力过大/);
  const partial = summaryFor(records, +new Date(2026, 10, 17, 9));
  assert.match(partial, /data-tone="unknown"/); assert.match(partial, /今日信息还不完整/);
  assert.match(partial, /今日数据 3 \/ 3 · 可比较 2 \/ 3/);
  assert.match(partial, /data-level="partial"/); assert.match(partial, /窗口未结束/);
  const incomplete = summaryFor(records.filter(record => record.type !== 'sleep'));
  assert.match(incomplete, /data-tone="unknown"/); assert.match(incomplete, /今日数据 2 \/ 3 · 可比较 2 \/ 3/);
  assert.doesNotMatch(incomplete, /今日接近日常/);
});

test('趋势、睡眠、活动和生活回顾共用日周月控件，并明确当前周期日期', () => {
  for (const view of ['trends', 'sleep', 'activity', 'review']) for (const period of ['day', 'week', 'month']) {
    const html = renderApp(stateFor(view, [], [], { period }));
    const buttons = [...html.matchAll(/<button data-action="range" data-range="([^"]+)" aria-pressed="([^"]+)" class="[^"]*">([^<]+)<\/button>/g)];
    assert.deepEqual(buttons.map(match => [match[1], match[3]]), [['day', '日'], ['week', '周'], ['month', '月']]);
    assert.deepEqual(buttons.filter(match => match[2] === 'true').map(match => match[1]), [period]);
    const unit = { day: '日', week: '周', month: '月' }[period];
    assert.match(html, new RegExp(`aria-label="上一${unit}"`));
    assert.match(html, new RegExp(`aria-label="下一${unit}" disabled`));
    assert.doesNotMatch(html, /data-range="(?:7|28|90)"/);
    if (period === 'week') assert.match(html, /11\/16 — 11\/22 · 周一至周日 · 更新至今天/);
    if (period === 'month') assert.match(html, /2026 年 11 月 · 按日查看 · 更新至今天/);
  }
});

test('日趋势使用小时读数与缺失时段，不能套用完整日基线', () => {
  const records = [[8, 15, 30], [8, 45, 50], [10, 15, 60]].map(([hour, minute, value]) => {
    const end = +new Date(2026, 10, 17, hour, minute);
    return { type: 'hrv', value, start: end, end, source: 'Watch', unit: 'ms' };
  });
  for (let day = 10; day < 17; day++) {
    const end = +new Date(2026, 10, day, 8);
    records.push({ type: 'hrv', value: 50, start: end, end, source: 'Watch', unit: 'ms' });
  }
  const state = stateFor('trends', records, [], { period: 'day' });
  state.trendDay = +new Date(2026, 10, 17, 8);
  let html = renderApp(state);
  const chart = html.match(/<svg class="line-chart"[\s\S]*?<\/svg>/)[0];
  assert.match(html, /08:00 · 小时中位数/); assert.match(html, /<strong>40<small>ms/);
  assert.match(chart, /2 小时有数据，11 小时无数据/);
  assert.equal((chart.match(/class="chart-line"/g) || []).length, 2);
  assert.doesNotMatch(chart, /chart-range-band|data-level="(?:below|usual|above)"/);
  assert.match(chart, /data-level="partial"/);
  assert.match(html, /小时值仅展示记录，不套用每日基线/);
  assert.match(html, /查看每小时数值/); assert.match(html, /有数据的小时<\/span><b>2 \/ 13/);
  assert.match(html, /id="trend-position"[^>]*value="8"[^>]*aria-label="趋势时段"/);
  state.trendDay = +new Date(2026, 10, 17, 9);
  html = renderApp(state);
  const focus = html.split('class="trend-focus"')[1].split('class="chart-wrap"')[0];
  assert.match(focus, /09:00 · 小时中位数/); assert.match(focus, /<strong>—<small>ms/);
  assert.match(focus, /data-level="noData"/);
  assert.match(focus, /该时段暂无记录，不补零/);
  const table = html.match(/<details class="data-table" id="daily-values">[\s\S]*?<\/details>/)[0];
  assert.doesNotMatch(table, /含个人范围分级/);
});

test('历史自然月完整保留日期与日志，日期选择不受当前周期限制', () => {
  const at = +new Date(2026, 9, 31, 8);
  const journal = [{ id: 'old', kind: 'note', value: '十月记录', note: '', at },
    { id: 'current', kind: 'note', value: '十一月记录', note: '', at: now }];
  const state = stateFor('review', [], journal, { period: 'month', periodAnchor: +new Date(2026, 9, 15) });
  const html = renderApp(state);
  assert.equal(state.journalReport.daily.length, 31);
  assert.equal((html.match(/class="day-choice"/g) || []).length, 31);
  assert.match(html, /十月记录/); assert.doesNotMatch(html, /十一月记录/);
  assert.match(html, /2026 年 10 月 · 按日查看/);
  assert.match(html, /id="review-date"[^>]*value="2026-10-31" min="1970-01-01" max="2026-11-17"/);
  for (const direction of ['previous', 'next']) {
    const button = html.match(new RegExp(`<button[^>]*id="review-${direction}"[^>]*>`))[0];
    assert.doesNotMatch(button, /disabled/); assert.match(button, /data-action="period-step"/);
  }
  assert.match(html, /data-action="period-today"[^>]*>回到本月/);
  assert.doesNotMatch(html, /更新至今天/);
});

test('呼吸以准备、进行、完成表现进度，不生成健康评级', () => {
  const state = stateFor('breathe');
  assert.match(renderApp(state), /data-phase="ready"/);
  state.breathing = { running: true, elapsed: 10 };
  assert.match(renderApp(state), /data-phase="inhale"/);
  state.breathing = { running: false, elapsed: 60 };
  const html = renderApp(state);
  assert.match(html, /data-phase="complete"/);
  assert.match(html, /id="breath-phase">练习完成/);
  assert.match(html, /不记录分数/);
});

test('正负反馈保留语义、转义消息，只有新反馈带一次动效标记', () => {
  const state = stateFor('journal');
  state.notice = '<img src=x>记录已保存'; state.noticeTone = 'success'; state.noticeEnter = true;
  let html = renderApp(state);
  assert.match(html, /feedback-notice is-new" data-tone="success" role="status"/);
  assert.match(html, /操作成功/); assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
  state.noticeEnter = false; state.noticeTone = 'error'; state.notice = '保存失败，原内容保留';
  html = renderApp(state);
  assert.match(html, /data-tone="error" role="alert"/);
  assert.match(html, /需要处理/);
  assert.doesNotMatch(html, /feedback-notice is-new/);
  state.noticeTone = 'invalid';
  assert.match(renderApp(state), /data-tone="neutral" role="status"/);
});

for (const view of ['overview', 'trends', 'sleep', 'journal', 'entry', 'breathe', 'data', 'recovery', 'activity', 'review']) {
  test(`${view} 的真实空态和演示态均可渲染，不产生缺失变量`, () => {
    const empty = renderApp(stateFor(view));
    assert.match(empty, /<main id="main"/);
    assert.match(empty, /aria-current="page"/);
    assert.doesNotMatch(empty, /NaN|undefined|Infinity/);
    const demo = demoData(now);
    const state = stateFor(view, demo.records, demo.journal);
    state.mode = 'demo';
    const populated = renderApp(state);
    assert.match(populated, /所有数值均为虚构/);
    assert.match(populated, /data-action="demo-exit"/);
    assert.doesNotMatch(populated, /NaN|undefined|Infinity/);
  });
}

test('空记录显示未知，不能显示零小时或零次心率', () => {
  const overview = renderApp(stateFor());
  assert.match(overview, /metric-value">—<small>次\/分/);
  assert.match(overview, /等待第一份数据/);
  assert.doesNotMatch(overview, /0<small>小时/);
  const sleep = renderApp(stateFor('sleep'));
  assert.match(sleep, /sleep-total">—/);
  assert.match(sleep, /此窗口暂无睡眠记录；不代表没有睡眠/);
});

test('睡眠四舍五入只产生合法的分钟余数', () => {
  const records = [[17, 59.8], [16, 119.8]].map(([day, minutes]) => {
    const start = +new Date(2026, 10, day, 1);
    return { type: 'sleep', value: 'core', start, end: start + minutes * 60000, source: 'watch', unit: 'min' };
  });
  const state = stateFor('sleep', records);
  state.sleepDay = +new Date(2026, 10, 17);
  const html = renderApp(state);
  assert.match(html, /1<small>小时<\/small> 0<small>分/);
  assert.match(html, /2时0分/);
  assert.doesNotMatch(html, /小时<\/small> 60|时60分/);
});

test('来源、日志、错误和导入预览中的外部文本均转义', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const sample = { id: 'a', type: 'hrv', value: 40, unit: 'ms', source: attack, start: now - 60000, end: now - 60000 };
  const entry = { id: '\" onclick=\"alert(1)', kind: 'note', value: attack, note: attack, at: now - 60000 };
  for (const view of ['overview', 'trends', 'sleep', 'journal', 'entry', 'breathe', 'data', 'recovery', 'activity', 'review']) {
    const state = stateFor(view, [sample], [entry]);
    state.notice = attack;
    state.storageError = attack;
    state.importPreview = { records: [sample], journal: [entry], stats: { total: 1, accepted: 1, skipped: 0, duplicates: 0, sources: [attack], types: { hrv: 1 } }, warnings: [attack] };
    const html = renderApp(state);
    assert.doesNotMatch(html, /<img src=x|data-id="" onclick=/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  }
});

test('趋势对非 HRV 显示来源、完整年份及历史提示', () => {
  const timestamp = new Date(2025, 10, 17, 10).getTime();
  const records = [{ id: 'heart', type: 'heartRate', value: 72, unit: 'bpm', source: '旧手表来源', start: timestamp, end: timestamp }];
  const state = stateFor('trends', records);
  state.metric = 'heartRate'; state.series = dailySeries(records, 'heartRate', { now });
  const html = renderApp(state);
  assert.match(html, /全部数据中的最近记录/);
  assert.match(html, /所选时段的来源以图表上方标注为准/);
  assert.match(html, /旧手表来源/);
  assert.match(html, /2025年11月17日/);
  assert.match(html, /历史记录 \/ 非实时/);
});

test('活动来源忽略未来与无效记录，说明重叠统计限制', () => {
  const sample = (source, end, value = 100) => ({ id: source, type: 'steps', value, unit: 'count', source, start: end - 60000, end });
  const records = [sample('有效来源', now - 3600000), sample('未来来源', now + 10000), sample('负值来源', now - 1000, -1)];
  const state = stateFor('trends', records);
  state.metric = 'steps'; state.series = dailySeries(records, 'steps', { now });
  const html = renderApp(state);
  assert.match(html, /有效来源/);
  assert.doesNotMatch(html, /未来来源|负值来源/);
  assert.match(html, /非完全重复的重叠区间可能高估/);
  assert.match(html, /不保证等于 Apple 健康/);
});

test('没有样本的日期留空，SVG 不跨缺失天连线', () => {
  const state = stateFor('trends');
  state.series = [
    { day: '2026-11-15', at: now - 86400000 * 2, value: 40 },
    { day: '2026-11-16', at: now - 86400000, value: null },
    { day: '2026-11-17', at: now, value: 50 },
  ];
  const html = renderApp(state);
  assert.equal((html.match(/class="chart-line"/g) || []).length, 2);
  assert.match(html, /2026-11-16<\/th><td>—<\/td>/);
});

test('首页 HRV 图只展示所选来源的有效历史测量，空态不生成样本', () => {
  const sample = (value, source = 'watch', end = now - 60000) => ({ type: 'hrv', value, unit: 'ms', source, start: end, end });
  const records = [sample(56), sample(42), sample(80, 'other'), sample(99, 'watch', now + 60000), sample(-1), sample(NaN)];
  const state = stateFor('overview', records);
  state.analysis = analyze(records, { now, source: 'watch' });
  const html = renderApp(state);
  assert.equal((html.match(/class="sample-bar/g) || []).length, 2);
  assert.match(html, /最近 2 次 HRV 测量，按采样顺序排列/);
  assert.match(html, /class="sample-bar latest"/);
  assert.match(html, /class="sample-bar latest"[^>]*><title>[^<]*56 ms<\/title>/);
  assert.match(html, /class="data-table" id="hrv-values"/);
  assert.doesNotMatch(renderApp(stateFor()), /class="sample-bar/);
});

test('四个 App 一级入口唯一，二级页保留返回与父入口语义', () => {
  for (const [view, parent] of [['overview', 'overview'], ['trends', 'trends'], ['journal', 'journal'], ['data', 'data'], ['sleep', 'overview'], ['breathe', 'overview'], ['entry', 'journal'], ['recovery', 'overview'], ['activity', 'overview'], ['review', 'journal']]) {
    const html = renderApp(stateFor(view));
    const nav = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/g);
    assert.equal(nav.length, 1);
    assert.deepEqual([...nav[0].matchAll(/data-view="([^"]+)"/g)].map(match => match[1]), ['overview', 'trends', 'journal', 'data']);
    assert.match(nav[0], new RegExp(`data-view="${parent}"[^>]*aria-current="page"`));
    if (view !== parent) assert.match(html, new RegExp(`class="back-button[^>]*data-view="${parent}"[^>]*aria-label="返回`));
    assert.match(html, /aria-labelledby="screen-title"/);
    assert.doesNotMatch(html, /class="sidebar"|class="page-footer"/);
  }
});

test('记录列表和录入分成独立页面，表单保留所有校验字段', () => {
  const list = renderApp(stateFor('journal'));
  assert.doesNotMatch(list, /id="journal-form"/);
  assert.match(list, /data-view="entry"/);
  const editor = renderApp(stateFor('entry'));
  assert.match(editor, /id="journal-form"/);
  for (const name of ['kind', 'value', 'at', 'note']) assert.match(editor, new RegExp(`name="${name}"`));
  assert.match(editor, /name="value"[^>]*required/);
  assert.match(editor, /name="at"[^>]*required/);
  assert.doesNotMatch(editor, /class="journal-timeline"/);
});

test('恢复比较明确 SDNN 和非实时历史，训练缺心率不编造分区', () => {
  const old = now - 86400000;
  const records = [{ type: 'hrv', value: 40, start: old, end: old, unit: 'ms', source: 'Watch' },
    { type: 'workout', value: '<script>bad</script>', start: now - 3600000, end: now - 1800000, unit: 'min', source: '<Watch>' }];
  const recovery = renderApp(stateFor('recovery', records));
  assert.match(recovery, /HRV · SDNN/); assert.match(recovery, /历史记录/);
  assert.match(recovery, /不能与 StressWatch 的 RMSSD 数值直接比较/);
  const training = renderApp(stateFor('activity', records));
  assert.doesNotMatch(training, /<script>|<Watch>/);
  assert.match(training, /&lt;script&gt;bad/);
  assert.match(training, /不推算心率区间时长/);
});

test('生活回顾将同日身体数据与日志对齐并保留缺失提示', () => {
  const records = [{ type: 'hrv', value: 42, start: now - 1000, end: now - 1000, source: 'watch', unit: 'ms' }];
  const journal = [{ id: 'c', kind: 'caffeine', value: 0, at: now, note: '' }];
  const state = stateFor('review', records, journal);
  const html = renderApp(state);
  assert.match(html, /咖啡因记录<\/dt><dd>0/);
  assert.match(html, /HRV · SDNN<\/dt><dd>42/);
  assert.match(html, /饮水记录<\/dt><dd>—/);
  assert.match(html, /同时出现不代表因果/);
  state.reviewDay = +new Date(2026, 10, 16);
  const missing = renderApp(state);
  assert.match(missing, /未记录生活感受/);
  assert.match(missing, /HRV · SDNN<\/dt><dd>—/);
});

test('首页为缺失、陈旧、积累中和相对高低提供独立分级属性', () => {
  const sample = (value, end) => ({ type: 'hrv', value, start: end, end, source: 'watch', unit: 'ms' });
  const history = Array.from({ length: 7 }, (_, index) => sample(40, now - (index + 1) * 86400000));
  const cases = [
    [[], 'noData'], [[sample(40, now)], 'building'],
    [[...history, sample(40, now - 31 * 60000)], 'stale'],
    [[...history, sample(40, now)], 'usual'],
    [[...history, sample(20, now)], 'below'],
    [[...history, sample(60, now)], 'above'],
  ];
  for (const [records, level] of cases) {
    const html = renderApp(stateFor('overview', records));
    const card = html.match(/<section class="signal-card"[\s\S]*?<\/section>/)?.[0];
    assert.ok(card);
    assert.match(card, new RegExp(`data-grade="${level}"`));
    assert.match(card, /class="signal-hero" data-tone="(?:positive|care|neutral|unknown)"/);
    assert.match(card, /class="grade-art" data-tone="(?:positive|care|neutral|unknown)"/);
    assert.match(card, /aria-hidden="true"/);
    if (['noData', 'building', 'stale'].includes(level)) assert.doesNotMatch(card, /data-level="(?:usual|below|above)"/);
  }
});

test('历史各点使用自己的来源基线，趋势三档采用不同几何标记', () => {
  const records = [];
  for (let day = 1; day <= 7; day++) for (const [source, value] of [['A', 100], ['B', 1000]]) {
    const end = +new Date(2026, 10, day, 8);
    records.push({ type: 'steps', value, start: end, end, source, unit: 'count' });
  }
  const state = stateFor('trends', records); state.metric = 'steps';
  state.series = [
    { day: '2026-11-13', at: +new Date(2026, 10, 13), value: 100, source: 'A' },
    { day: '2026-11-14', at: +new Date(2026, 10, 14), value: 100, source: 'B' },
    { day: '2026-11-15', at: +new Date(2026, 10, 15), value: 2000, source: 'B' },
    { day: '2026-11-16', at: +new Date(2026, 10, 16), value: 100, source: 'New source' },
  ];
  const html = renderApp(state);
  for (const [day, level] of [['13', 'usual'], ['14', 'below'], ['15', 'above'], ['16', 'building']]) {
    const row = html.match(new RegExp(`<tr><th scope="row">2026-11-${day}<\\/th>[\\s\\S]*?<\\/tr>`))?.[0];
    assert.ok(row); assert.match(row, new RegExp(`data-level="${level}"`));
  }
  assert.match(html, /<rect class="chart-point chart-dot" data-level="usual"/);
  assert.match(html, /<path class="chart-point chart-dot" data-level="below"[^>]*h9l-4\.5 8z/);
  assert.match(html, /<path class="chart-point chart-dot" data-level="above"[^>]*h9l-4\.5-8z/);
  assert.match(html, /<circle class="chart-point chart-dot" data-level="building"/);
  assert.match(html, /参考带只在有效日来源一致且基线足够时显示/);
});

test('睡眠历史也按逐项来源分档，不沿用最近设备基线', () => {
  const state = stateFor('sleep');
  state.bands = new Map([
    [JSON.stringify(['sleep', 'Old Watch']), { days: 7, lower: 480, upper: 480 }],
    [JSON.stringify(['sleep', 'New Watch']), { days: 7, lower: 600, upper: 600 }],
  ]);
  state.sleeps = [
    { at: now - 86400000 * 2, minutes: 480, stages: {}, source: 'Old Watch' },
    { at: now - 86400000, minutes: 480, stages: {}, source: 'New Watch' },
  ];
  const html = renderApp(state);
  assert.deepEqual([...html.matchAll(/class="sleep-row" data-grade="([^"]+)"[^>]*data-day="([^"]+)"/g)].map(match => [Number(match[2]), match[1]]), [
    [now - 86400000, 'below'], [now - 86400000 * 2, 'usual'],
  ]);
});

test('今日步数和能量、中午前睡眠保持窗口未结束，缺失仍为未知', () => {
  const morning = +new Date(2026, 10, 17, 9);
  const records = [
    { type: 'steps', value: 0, start: morning - 60000, end: morning, source: 'Watch', unit: 'count' },
    { type: 'activeEnergy', value: 0, start: morning - 60000, end: morning, source: 'Watch', unit: 'kcal' },
    { type: 'sleep', value: 'core', start: +new Date(2026, 10, 16, 23), end: +new Date(2026, 10, 17, 7), source: 'Watch', unit: 'min' },
  ];
  for (const metric of ['steps', 'activeEnergy']) {
    const state = stateFor('trends', records); state.now = morning; state.metric = metric;
    state.series = dailySeries(records, metric, { now: morning, days: 1 });
    const html = renderApp(state);
    assert.match(html, /class="grade-panel(?: compact)?" data-level="partial"/);
    assert.doesNotMatch(html, /class="chart-point chart-dot" data-level="(?:below|usual|above)"/);
  }
  for (const view of ['overview', 'sleep']) {
    const state = stateFor(view, records); state.now = morning;
    state.analysis = analyze(records, { now: morning }); state.sleeps = sleepSeries(records, { now: morning });
    const html = renderApp(state);
    if (view === 'overview') {
      const cards = [...html.matchAll(/<button class="metric-card"[\s\S]*?<\/button>/g)].map(match => match[0]);
      for (const label of ['查看今日步数详情', '查看最近睡眠详情']) assert.match(cards.find(card => card.includes(label)), /data-grade="partial"/);
    } else assert.match(html, /class="panel sleep-summary" data-grade="partial"/);
  }
  const empty = stateFor('sleep'); empty.now = morning;
  assert.match(renderApp(empty), /class="panel sleep-summary" data-grade="noData"/);
});

test('日志和生活回顾保留半档心情、饮水量档和主动零值的视觉区分', () => {
  const journal = [
    { id: 'm2', kind: 'mood', value: 2, at: now - 1, note: '' },
    { id: 'm3', kind: 'mood', value: 3, at: now, note: '' },
    { id: 'w', kind: 'water', value: 600, at: now, note: '' },
    { id: 'c', kind: 'caffeine', value: 0, at: now, note: '' },
  ];
  for (const view of ['journal', 'review']) {
    const html = renderApp(stateFor(view, [], journal));
    assert.match(html, /data-level="mood"/); assert.match(html, /class="grade-art mood-art"/);
    assert.match(html, /有些低落—平常/); assert.match(html, /2\.5/);
    assert.match(html, /data-level="mid"/); assert.match(html, /中量记录/);
    assert.match(html, /data-level="zero"/); assert.match(html, /零值记录/);
    assert.doesNotMatch(html, /<b>(?:健康|正常|达标|安全|危险|过量)<\/b>/);
  }
});

test('录入预览与已保存记录共用分档，非法或文字输入不伪造数值判断', () => {
  assert.match(renderApp(stateFor('entry')), /id="entry-grade" aria-live="polite"/);
  for (const [kind, value, level] of [['water', '499', 'low'], ['water', '500', 'mid'], ['water', '1500', 'high'],
    ['caffeine', '0', 'zero'], ['caffeine', '200', 'high'], ['mood', '5', 'mood'], ['water', '', 'noData']]) {
    assert.match(renderEntryGrade(kind, value), new RegExp(`data-level="${level}"`));
  }
  for (const [kind, value] of [['mood', '2.5'], ['water', '-1'], ['water', '10001'], ['caffeine', '2001']]) {
    assert.doesNotMatch(renderEntryGrade(kind, value), /class="grade-panel(?: compact)?"/);
  }
  assert.doesNotMatch(renderEntryGrade('note', '<img src=x>'), /data-level=|<img/);
  for (const [kind, value] of [['water', '<img src=x>'], ['mood', '9'], ['mood', '0']]) {
    assert.match(renderEntryGrade(kind, value), /填写有效数值/);
    assert.doesNotMatch(renderEntryGrade(kind, value), /data-level=|<img/);
  }
});

test('训练列表和每日图按时长分档，期间总时长不冒充单日时长', () => {
  const records = [10, 30, 90].map((minutes, index) => {
    const start = +new Date(2026, 10, 14 + index, 8);
    return { type: 'workout', value: 'HKWorkoutActivityTypeWalking', source: 'Watch', unit: 'min', start, end: start + minutes * 60000 };
  });
  const html = renderApp(stateFor('activity', records));
  assert.deepEqual([...html.matchAll(/class="workout-detail" data-grade="([^"]+)"/g)].map(match => match[1]), ['high', 'mid', 'low']);
  for (const level of ['noData', 'low', 'mid', 'high']) assert.match(html, new RegExp(`class="activity-bar-slot"[^>]*data-level="${level}"`));
  assert.match(html, /class="grade-panel(?: compact)?" data-level="mid"[\s\S]*?有训练记录日均 \/ 43\.3 分/);
  assert.match(html, /仅描述时长，不代表强度/);
});

test('身体分级的关照语义按指标方向区别，缺失不显示正向角色', () => {
  const sample = (type, value, end) => ({ type, value, start: end, end, source: 'watch', unit: type === 'hrv' ? 'ms' : 'bpm' });
  for (const [current, level, tone] of [[20, 'below', 'care'], [40, 'usual', 'positive'], [60, 'above', 'neutral']]) {
    const history = Array.from({ length: 7 }, (_, index) => sample('hrv', 40, now - (index + 1) * 86400000));
    const html = renderApp(stateFor('overview', [...history, sample('hrv', current, now)]));
    const card = html.match(/<section class="signal-card"[\s\S]*?<\/section>/)?.[0];
    assert.ok(card);
    assert.match(card, new RegExp(`data-grade="${level}"`));
    assert.match(card, new RegExp(`class="signal-hero" data-tone="${tone}"`));
    assert.match(card, new RegExp(`<svg class="grade-art" data-tone="${tone}"`));
  }
  const restHistory = Array.from({ length: 7 }, (_, index) => sample('restingHeartRate', 55, now - (index + 1) * 86400000));
  const recovery = renderApp(stateFor('recovery', [...restHistory, sample('restingHeartRate', 70, now)]));
  const resting = [...recovery.matchAll(/<details class="recovery-item"[\s\S]*?<\/details>/g)]
    .map(match => match[0]).find(card => card.includes('id="recovery-restingHeartRate"'));
  assert.ok(resting); assert.match(resting, /data-level="above" data-tone="care"/);
  const missing = renderApp(stateFor('overview')).match(/<section class="signal-card"[\s\S]*?<\/section>/)?.[0];
  assert.ok(missing); assert.match(missing, /data-grade="noData"/);
  assert.match(missing, /class="signal-hero" data-tone="unknown"/);
  assert.doesNotMatch(missing, /data-tone="positive"/);
});

test('心情回应与记录量回应分离，不用更高饮水或训练时长兑换正反馈', () => {
  for (const [kind, value, level, tone] of [['mood', '1', 'mood', 'care'], ['mood', '5', 'mood', 'positive'],
    ['water', '1500', 'high', 'neutral'], ['caffeine', '200', 'high', 'care']]) {
    const html = renderEntryGrade(kind, value);
    assert.match(html, new RegExp(`class="grade-panel(?: compact)?" data-level="${level}" data-tone="${tone}"`));
    assert.match(html, new RegExp(`<svg class="grade-art(?: mood-art)?" data-tone="${tone}"`));
  }
  const start = now - 90 * 60000;
  const html = renderApp(stateFor('activity', [{ type: 'workout', value: 'HKWorkoutActivityTypeWalking', source: 'Watch', unit: 'min', start, end: now }]));
  const detail = html.match(/<details class="workout-detail"[\s\S]*?<\/details>/)?.[0];
  assert.ok(detail); assert.match(detail, /data-level="high" data-tone="neutral"/);
  assert.doesNotMatch(detail, /data-tone="positive"/);
  assert.match(detail, /时长更长不代表效果更好/);
  assert.match(renderEntryGrade('caffeine', '200'), /这一档不等于过量/);
});

test('趋势选日同步日期与读数，缺失日保持可选且不冒用最近值', () => {
  const records = [[15, 40], [17, 80]].map(([day, value]) => {
    const end = +new Date(2026, 10, day, 8);
    return { type: 'hrv', value, start: end, end, source: 'Watch', unit: 'ms' };
  });
  const state = stateFor('trends', records);
  state.trendDay = +new Date(2026, 10, 15);
  let html = renderApp(state);
  let focus = html.split('class="trend-focus"')[1].split('class="chart-wrap"')[0];
  assert.match(focus, /11\/15/); assert.match(focus, /<strong>40<small>ms/);
  assert.match(focus, /Watch/);
  assert.match(html, /id="trend-date"[^>]*value="2026-11-15"/);
  assert.match(html, /id="trend-position"[^>]*value="14"/);
  assert.match(html, /class="chart-cursor"/);
  state.trendDay = +new Date(2026, 10, 16);
  html = renderApp(state);
  focus = html.split('class="trend-focus"')[1].split('class="chart-wrap"')[0];
  assert.match(focus, /<strong>—<small>ms/);
  assert.match(focus, /data-level="noData"/);
  assert.match(focus, /当天暂无记录，不补零/);
  assert.doesNotMatch(focus, /<strong>(?:40|80)<small>/);
  assert.match(html, /id="trend-position"[^>]*value="15"/);
  assert.equal((html.match(/class="chart-line"/g) || []).length, 2);
});

test('趋势参考带要求有效日同源且基线足够，缺失日不抢占来源', () => {
  const state = stateFor('trends'); state.metric = 'steps';
  state.series = [
    { day: '2026-11-15', at: +new Date(2026, 10, 15), value: 100, source: 'A' },
    { day: '2026-11-16', at: +new Date(2026, 10, 16), value: null, source: null },
    { day: '2026-11-17', at: +new Date(2026, 10, 17), value: 200, source: 'A' },
  ];
  state.bands = new Map([
    [JSON.stringify(['steps', 'A']), { days: 7, lower: 80, upper: 120 }],
    [JSON.stringify(['steps', 'B']), { days: 7, lower: 800, upper: 1200 }],
  ]);
  const sameSource = renderApp(state);
  assert.match(sameSource, /class="chart-range-band"/);
  assert.match(sameSource, /个人常见范围 80–120 步/);
  state.series[2].source = 'B';
  assert.doesNotMatch(renderApp(state), /class="chart-range-band"/);
  state.series[2].source = 'A';
  state.bands.get(JSON.stringify(['steps', 'A'])).days = 6;
  assert.doesNotMatch(renderApp(state), /class="chart-range-band"/);
  state.series = state.series.map(day => ({ ...day, value: null, source: null }));
  assert.doesNotMatch(renderApp(state), /class="chart-range-band"|class="chart-point/);
});

test('睡眠选日展示该日真实分期与起止，时间缺口不填充为睡眠或清醒', () => {
  const sleep = (day, startHour, endHour, value) => ({ type: 'sleep', value,
    start: +new Date(2026, 10, day, startHour), end: +new Date(2026, 10, day, endHour), source: 'Watch', unit: 'min' });
  const records = [sleep(16, 0, 2, 'deep'), sleep(17, 0, 1, 'core'), sleep(17, 3, 4, 'core'),
    { ...sleep(17, 2, 3, 'awake'), end: +new Date(2026, 10, 17, 2, 30) }];
  const state = stateFor('sleep', records);
  state.sleepDay = +new Date(2026, 10, 17);
  let html = renderApp(state);
  assert.match(html, /id="sleep-date"[^>]*value="2026-11-17"/);
  assert.match(html, /sleep-total">2<small>小时<\/small> 0<small>分/);
  assert.match(html, /记录开始<\/span><b>00:00/);
  assert.match(html, /记录结束<\/span><b>04:00/);
  const segments = [...html.matchAll(/<rect class="sleep-segment ([^"]+)" x="([^"]+)" y="[^"]+" width="([^"]+)"/g)];
  assert.deepEqual(segments.map(match => match[1]), ['stage-core', 'stage-awake', 'stage-core']);
  assert.ok(Number(segments[0][2]) + Number(segments[0][3]) < Number(segments[1][2]));
  assert.ok(Number(segments[1][2]) + Number(segments[1][3]) < Number(segments[2][2]));
  assert.match(html, /空白表示没有记录，不推断为清醒/);
  assert.match(html, /不能确定实际入睡和起床时刻/);
  state.sleepDay = +new Date(2026, 10, 16);
  html = renderApp(state);
  assert.deepEqual([...html.matchAll(/class="sleep-segment ([^"]+)"/g)].map(match => match[1]), ['stage-deep']);
  assert.match(html, /记录结束<\/span><b>02:00/);
  state.sleepDay = +new Date(2026, 10, 15);
  html = renderApp(state);
  assert.match(html, /sleep-total">—/);
  assert.match(html, /当天暂无可展示的睡眠分期记录/);
  assert.doesNotMatch(html, /class="sleep-segment/);
});

test('自然月回顾保留日期导航，只展示选中一天且日均不把缺失算零', () => {
  const journal = [
    { id: 'water', kind: 'water', value: 400, note: '选中日记录', at: +new Date(2026, 10, 15, 8) },
    { id: 'zero', kind: 'caffeine', value: 0, note: '另一日记录', at: now },
  ];
  const state = stateFor('review', [], journal);
  state.reviewDay = +new Date(2026, 10, 15);
  let html = renderApp(state);
  assert.equal((html.match(/class="review-day"/g) || []).length, 1);
  assert.equal((html.match(/class="day-choice"/g) || []).length, 17);
  assert.match(html, /aria-label="2026-11-15，有记录"/);
  assert.doesNotMatch(html, /aria-label="，/);
  assert.equal((html.match(/class="review-event"/g) || []).length, 1);
  assert.match(html, /id="review-date"[^>]*value="2026-11-15"/);
  assert.match(html, /选中日记录/); assert.doesNotMatch(html, /另一日记录/);
  assert.match(html, /饮水记录日均<\/span><b>400 ml<\/b><small>1 个记录日/);
  assert.match(html, /咖啡因记录日均<\/span><b>0 mg<\/b><small>1 个记录日/);
  state.reviewDay = +new Date(2026, 10, 16);
  html = renderApp(state);
  assert.match(html, /未记录生活感受/);
  assert.equal((html.match(/class="review-event"/g) || []).length, 0);
  assert.match(html, /饮水记录<\/dt><dd>—/);
});

test('同日尚未发生的日志不进入回顾事件，与汇总排除未来口径一致', () => {
  const journal = [{ id: 'future', kind: 'note', value: '未来一分钟的记录', note: '', at: now + 60000 }];
  const html = renderApp(stateFor('review', [], journal));
  assert.match(html, /未记录生活感受/);
  assert.doesNotMatch(html, /未来一分钟的记录|class="review-event"/);
});

test('四种记录快捷入口与五档心情可辨识，快捷量只预填而不自动提交', () => {
  const journal = renderApp(stateFor('journal'));
  const shortcuts = journal.match(/<div class="journal-shortcuts">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.deepEqual([...shortcuts.matchAll(/data-entry-kind="([^"]+)"/g)].map(match => match[1]), ['mood', 'water', 'caffeine', 'note']);
  const options = renderEntryOptions('mood', '3');
  const buttons = [...options.matchAll(/<button[^>]*>/g)].map(match => match[0]);
  assert.equal(buttons.length, 5);
  for (const [index, button] of buttons.entries()) {
    assert.match(button, /type="button"/);
    assert.match(button, new RegExp(`data-action="entry-value" data-value="${index + 1}"`));
    assert.match(button, new RegExp(`aria-pressed="${index === 2}"`));
    assert.match(button, /aria-label="[^\"]+，\d 分"/);
  }
  const water = renderEntryOptions('water', '250');
  assert.deepEqual([...water.matchAll(/data-value="([^"]+)"/g)].map(match => match[1]), ['150', '250', '350', '500']);
  assert.equal((water.match(/type="button"/g) || []).length, 4);
  assert.doesNotMatch(options + water, /type="submit"/);
  assert.match(renderEntryOptions('caffeine', ''), /不用杯数猜测/);
  const state = stateFor('entry'); state.entryDraft = { kind: 'water', value: '250', note: '' };
  const editor = renderApp(state);
  assert.match(editor, /id="entry-value"[^>]*inputmode="decimal"[^>]*value="250"/);
  assert.equal((editor.match(/type="submit"/g) || []).length, 1);
});

test('录入草稿的值、时间和备注转义，非法类型回退而不能注入控件', () => {
  const attack = '"><img src=x onerror="alert(1)">';
  const state = stateFor('entry');
  state.entryDraft = { kind: attack, value: attack, at: attack, note: '</textarea><script>alert(1)</script>' };
  const html = renderApp(state);
  assert.doesNotMatch(html, /<img src=x|<script>|value=""[\s>]+onerror/);
  assert.match(html, /value="&quot;&gt;&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;"/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<option value="mood" selected>/);
  assert.match(html, /刷新后丢弃/);
});

test('恢复默认显示五项折叠摘要，依据与来源仍保留在各项详情', () => {
  const demo = demoData(now);
  const html = renderApp(stateFor('recovery', demo.records));
  const cards = [...html.matchAll(/<details class="recovery-item"[\s\S]*?<\/details>/g)].map(match => match[0]);
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map(card => card.match(/id="recovery-([^"]+)"/)[1]), ['hrv', 'restingHeartRate', 'sleep', 'respiratoryRate', 'oxygenSaturation']);
  for (const card of cards) {
    assert.doesNotMatch(card.split('>')[0], /\bopen\b/);
    const summary = card.match(/<summary[\s\S]*?<\/summary>/)[0];
    assert.match(summary, /class="recovery-reading"/);
    assert.match(summary, /class="grade-badge/);
    assert.match(card, /class="recovery-body"/);
    assert.match(card, /个人常见范围/); assert.match(card, /有效历史/);
    assert.match(card, /最后记录/); assert.match(card, /data-action="navigate"/);
  }
  assert.match(html, /全天可用样本的中位数不等同于夜间生命体征/);
  assert.match(html, /缺失不会补零，历史样本不会被标成今天/);
});

test('数据覆盖呈现九类指标与缺失状态，并提供正确模块入口', () => {
  const records = [{ type: 'hrv', value: 42, start: now - 60000, end: now - 60000, unit: 'ms', source: 'Watch' }];
  const state = stateFor('data', records); state.lastImport = now;
  const html = renderApp(state);
  const coverage = html.match(/<section class="coverage-panel">[\s\S]*?<\/section>/)[0];
  const links = [...coverage.matchAll(/<button class="coverage-link"[\s\S]*?<\/button>/g)].map(match => match[0]);
  assert.equal(links.length, 9);
  assert.equal((coverage.match(/暂无已发生的记录/g) || []).length, 8);
  assert.match(coverage, /1 \/ 9 类/); assert.match(coverage, /上次导入/);
  assert.match(links.find(link => link.includes('HRV · SDNN')), /data-view="trends" data-metric="hrv"/);
  assert.match(links.find(link => link.includes('<b>睡眠</b>')), /data-view="sleep"/);
  assert.match(links.find(link => link.includes('<b>体能训练</b>')), /data-view="activity"/);
  const empty = renderApp(stateFor('data')).match(/<section class="coverage-panel">[\s\S]*?<\/section>/)[0];
  assert.match(empty, /0 \/ 9 类/);
  assert.equal((empty.match(/暂无已发生的记录/g) || []).length, 9);
  assert.match(empty, /不会自动从 Apple Watch 同步/);
});

test('所有显式新增入口都携带记录类型，不会沿用未结束的更正上下文', () => {
  for (const view of ['overview', 'recovery', 'journal', 'breathe']) {
    const state = stateFor(view);
    state.editingId = 'unfinished-edit';
    state.entryDraft = { kind: 'water', value: '250', note: '未结束的更正' };
    if (view === 'breathe') state.breathing = { running: false, elapsed: 60 };
    const entries = [...renderApp(state).matchAll(/<button\b[^>]*>/g)]
      .map(match => match[0]).filter(button => button.includes('data-action="navigate"') && button.includes('data-view="entry"'));
    assert.ok(entries.length > 0, `${view} 缺少新增入口`);
    for (const button of entries) assert.match(button, /data-entry-kind="(?:mood|water|caffeine|note)"/, `${view} 的新增入口缺少明确类型`);
  }
});
