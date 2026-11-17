import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calendarPeriod } from '../core.mjs';
import { journalEntry } from '../model.mjs';
import { renderEntryGrade } from '../views.mjs';

const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
const fixedNow = new Date(2026, 10, 17, 12).getTime();
const functionSource = name => {
  const found = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'));
  assert.ok(found, `生产函数 ${name} 必须存在`);
  return found[0];
};
const listenerSource = type => {
  const start = source.indexOf(`root.addEventListener('${type}',`);
  const end = source.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 4);
};

function submitButton(text = '保存记录') {
  return { disabled: false, dataset: {}, attrs: {}, children: [{ className: 'submit-label', textContent: text }, { tagName: 'svg', textContent: '' }],
    setAttribute(name, value) { this.attrs[name] = value; },
    querySelector(selector) { return this.children.find(child => selector === '.submit-label' ? child.className === 'submit-label' : selector === 'svg' && child.tagName === 'svg') || null; },
    get textContent() { return this.children.map(child => child.textContent).join(''); },
    set textContent(value) { this.children = [{ textContent: String(value) }]; },
  };
}

function harness() {
  const listeners = {}, values = { kind: 'mood', value: '3', note: '保留感受', at: '2026-11-17T10:00' };
  let errorRemoved = 0;
  const feedback = { textContent: '', focusCount: 0, focus() { this.focusCount++; }, remove() { errorRemoved++; } };
  const submit = submitButton();
  const form = { id: 'journal-form', values, isConnected: true, attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    querySelector: selector => selector === '[type="submit"]' ? submit : selector === '[role="alert"]' ? feedback : null,
    append() { throw new Error('当前测试已有错误反馈节点，不应创建新节点'); } };
  const fields = Object.fromEntries(Object.keys(values).map(name => [name, {
    name, disabled: false,
    get value() { return values[name]; }, set value(value) { values[name] = value; },
    attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, closest: () => form,
  }]));
  form.elements = [...Object.values(fields), submit];
  const preview = { innerHTML: '' }, options = { innerHTML: '', querySelectorAll: () => [] }, caption = { textContent: '' };
  const main = { focus() {}, scrollTo() {} };
  const root = {
    querySelector: selector => ({ '#journal-form': form, '#entry-kind': fields.kind, '#entry-value': fields.value,
      '#entry-grade': preview, '#entry-options': options, '#entry-value-label': caption, main })[selector] || null,
    querySelectorAll: () => [], addEventListener: (type, listener) => { listeners[type] = listener; },
  };
  const context = vm.createContext({
    state: { view: 'overview', mode: 'real', metric: 'hrv', period: 'day', periodAnchor: null, notice: '', entryDraft: null,
      trendDay: null, sleepDay: null, reviewDay: null, activityDay: null,
      records: [], journal: [], source: 'auto', backView: null, series: [], sleeps: [], journalReport: { daily: [] }, workouts: { daily: [] } },
    Date: class extends Date { static now() { return fixedNow; } }, calendarPeriod,
    views: ['overview', 'trends', 'sleep', 'journal', 'entry', 'breathe', 'data', 'recovery', 'activity', 'review'],
    entryKinds: ['mood', 'water', 'caffeine', 'note'],
    dayFields: { trends: 'trendDay', sleep: 'sleepDay', review: 'reviewDay', activity: 'activityDay' },
    navigationTrail: [], renderedMode: 'real', root, document: { activeElement: null, querySelector: () => main },
    FormData: class {
      constructor(form) { this.values = Object.fromEntries(form.elements.filter(field => field.name && !field.disabled).map(field => [field.name, field.value])); }
      [Symbol.iterator]() { return Object.entries(this.values)[Symbol.iterator](); }
    },
    renderCount: 0, renderIntents: [], stopCount: 0, busy: false, journalSaving: false, entryGrades: new WeakMap(), motionCalls: [], notices: [],
    render(intent = 'none') { context.renderCount++; context.renderIntents.push(intent); form.isConnected = context.state.view === 'entry'; },
    stopBreathing() { context.stopCount++; },
    playMotion(...args) { context.motionCalls.push(args); },
    renderEntryGrade: (kind, value) => `grade:${kind}:${value}`, renderEntryOptions: (kind, value) => `options:${kind}:${value}`,
    real: { records: [], journal: [], lastImport: null },
    journalEntry: fields => ({ ...fields, id: 'test-entry' }),
    notify(message, tone) { context.notice = message; context.notices.push({ message, tone, view: context.state.view }); },
  });
  const entries = [], history = {
    state: null, index: -1,
    replaceState(data) { this.state = structuredClone(data); if (this.index < 0) this.index = 0; entries[this.index] = this.state; },
    pushState(data) { this.state = structuredClone(data); entries.splice(++this.index); entries[this.index] = this.state; },
    back() { if (this.index > 0) { this.state = entries[--this.index]; context.restoreNavigation({ state: this.state }); } },
    forward() { if (this.index + 1 < entries.length) { this.state = entries[++this.index]; context.restoreNavigation({ state: this.state }); } },
  };
  context.history = history;
  vm.runInContext(['captureEntryDraft', 'routeSnapshot', 'writeNavigation', 'prepareEntryKind', 'editJournal', 'navigate', 'restoreNavigation',
    'daySeries', 'selectDay', 'selectChartDay', 'selectPeriodDate', 'revealSelectedDays', 'showReal', 'changeEntryKind', 'updateEntryGrade', 'setFormBusy'].map(functionSource).join('\n'), context);
  vm.runInContext(['click', 'change', 'input', 'submit'].map(listenerSource).join('\n'), context);
  context.writeNavigation(true);
  return { context, history, entries, listeners, form, values, fields, preview, options, caption, feedback, submit, get errorRemoved() { return errorRemoved; } };
}

test('二级上下文返回与浏览器前进后退恢复原指标，主导航重置上下文', () => {
  const { context: c, history, entries } = harness();
  c.navigate('recovery'); c.navigate('trends', { metric: 'restingHeartRate' });
  assert.equal(c.state.backView, 'recovery');
  history.back(); assert.equal(c.state.view, 'recovery'); assert.equal(c.state.backView, 'overview');
  history.forward(); assert.equal(c.state.view, 'trends'); assert.equal(c.state.metric, 'restingHeartRate');
  assert.equal(entries.length, 3, 'popstate 不再次写入历史');
  c.navigate('journal', { primary: true }); assert.equal(c.state.backView, null);
  assert.equal(c.navigationTrail.length, 0);
  assert.ok(entries.every(entry => !('records' in entry.zhixi) && !('entryDraft' in entry.zhixi)));
  c.restoreNavigation({ state: { zhixi: { view: 'unknown' } } }); assert.equal(c.state.view, 'journal');
});

test('离开录入保存内存草稿，切换类型清空单位相关数值而保留备注时间', () => {
  const { context: c, values } = harness();
  c.state.view = 'entry'; c.navigate('journal', { primary: true });
  assert.equal(c.state.entryDraft.value, '3'); assert.equal(c.state.entryDraft.note, values.note);
  c.navigate('entry', { entryKind: 'water' });
  assert.equal(c.state.entryDraft.kind, 'water'); assert.equal(c.state.entryDraft.value, '');
  assert.equal(c.state.entryDraft.note, '保留感受'); assert.equal(c.state.entryDraft.at, values.at);
  c.state.mode = 'demo'; c.showReal(); assert.equal(c.state.entryDraft, null);
  c.renderedMode = 'demo'; c.captureEntryDraft(); assert.equal(c.state.entryDraft, null, '旧模式的 DOM 不能带回草稿');
});

test('快捷选择只预填，不保存；字段名称、输入模式与预览同步类型', async () => {
  const h = harness(), { context: c, listeners, fields, values } = h;
  c.state.view = 'entry';
  const click = dataset => listeners.click({ target: { closest: () => ({ dataset }) } });
  await click({ action: 'entry-kind', kind: 'water' });
  assert.equal(values.kind, 'water'); assert.equal(values.value, ''); assert.equal(values.note, '保留感受');
  assert.equal(fields.value.inputMode, 'decimal'); assert.equal(fields.value.attrs['aria-label'], '饮水量 / ml');
  await click({ action: 'entry-value', value: '250' });
  assert.equal(values.value, '250'); assert.equal(c.state.journal.length, 0);
  assert.equal(h.options.innerHTML, 'options:water:250'); assert.equal(h.preview.innerHTML, 'grade:water:250');
  assert.equal(c.state.entryDraft.value, '250'); assert.ok(h.errorRemoved > 0);
  await click({ action: 'entry-kind', kind: 'note' }); assert.equal(fields.value.inputMode, 'text');
});

test('四模块日期选择只接受序列内日期，包括缺失值当天', () => {
  const { context: c } = harness();
  const first = new Date(2026, 10, 16).getTime(), second = new Date(2026, 10, 17).getTime();
  const days = [{ at: first, day: '2026-11-16', value: 8 }, { at: second, day: '2026-11-17', value: null }];
  c.state.series = days; c.state.sleeps = days; c.state.journalReport.daily = days; c.state.workouts.daily = days;
  for (const [scope, field] of Object.entries(c.dayFields)) {
    c.selectDay(scope, String(second)); assert.equal(c.state[field], second);
    c.selectDay(scope, '2026-11-16'); assert.equal(c.state[field], first);
    c.selectDay(scope, '999'); assert.equal(c.state[field], first);
  }
  const before = c.renderCount; c.selectDay('__proto__', '100'); assert.equal(c.renderCount, before);
  c.selectDay('activity', 'all'); assert.equal(c.state.activityDay, null);
  c.selectDay('trends', 'all'); assert.equal(c.state.trendDay, first);
});

test('回顾和活动日期输入按本地午夜更新周期及详情，不要求 daily 带 day 字段', () => {
  const { context: c, listeners } = harness();
  const first = new Date(2026, 10, 16).getTime(), second = new Date(2026, 10, 17).getTime();
  c.state.journalReport.daily = [{ at: first, mood: null }, { at: second, mood: 4 }];
  c.state.workouts.daily = [{ at: first, count: 0 }, { at: second, count: 1 }];
  for (const [scope, id] of [['review', 'review-date'], ['activity', 'activity-date']]) {
    const field = c.dayFields[scope]; c.state[field] = second;
    listeners.change({ target: { id, value: '2026-11-16', closest: () => null } });
    assert.equal(c.state[field], first, `${scope} 选中无数据的当天，而不是退回最近有记录日`);
    assert.equal(c.state.periodAnchor, first);
    assert.equal(c.history.state.zhixi.periodAnchor, first);
    assert.equal(c.renderIntents.at(-1), 'filter');
    listeners.change({ target: { id, value: '2026-11-17', closest: () => null } });
    assert.equal(c.state[field], second);
  }
});

test('日期输入拒绝归一化的非法或未来日期；允许合法闰日和跨周期日期', () => {
  const { context: c, listeners } = harness();
  const chosen = new Date(2026, 1, 28).getTime(), leapDay = new Date(2024, 1, 29).getTime();
  const days = [leapDay, chosen, new Date(2026, 2, 1).getTime(), new Date(2026, 2, 2).getTime(), new Date(2026, 11, 1).getTime()].map(at => ({ at }));
  c.state.period = 'week';
  c.state.series = days; c.state.sleeps = days; c.state.journalReport.daily = days; c.state.workouts.daily = days;
  for (const [scope, id] of [['trends', 'trend-date'], ['sleep', 'sleep-date'], ['review', 'review-date'], ['activity', 'activity-date']]) {
    const field = c.dayFields[scope]; c.state[field] = chosen;
    const before = c.renderCount;
    for (const value of ['2026-02-29', '2026-02-30', '2026-11-31', '2026-00-15', '2026-13-01', '2026-02-00', '2026-2-28', '', 'not-a-date', '2026-11-18', '2026-12-02', '1969-01-01']) {
      listeners.change({ target: { id, value, closest: () => null } });
      assert.equal(c.state[field], chosen, `${scope} 拒绝 ${JSON.stringify(value)}`);
    }
    assert.equal(c.renderCount, before, '非法输入不重绘、不播放动效');
    listeners.change({ target: { id, value: '2024-02-29', closest: () => null } });
    assert.equal(c.state[field], leapDay);
    assert.equal(c.state.periodAnchor, leapDay);
    const outside = new Date(2024, 1, 28).getTime();
    listeners.change({ target: { id, value: '2024-02-28', closest: () => null } });
    assert.equal(c.state[field], outside, '日期输入允许跳到当前图表范围外的历史日期');
    assert.equal(c.state.periodAnchor, outside);
    c.selectDay(scope, String(chosen)); assert.equal(c.state[field], chosen, '日期条的时间戳输入仍有效');
  }
});

test('日视图选择日期保留小时自动选点，切换粒度延续明确选中的日期', async () => {
  const { context: c, listeners } = harness();
  const selected = new Date(2026, 9, 31).getTime();
  c.state.view = 'trends';
  c.state.trendDay = fixedNow;
  listeners.change({ target: { id: 'trend-date', value: '2026-10-31', closest: () => null } });
  assert.equal(c.state.periodAnchor, selected);
  assert.equal(c.state.trendDay, null, '日趋势不能把午夜误当成用户选中的测量小时');
  for (const field of ['sleepDay', 'reviewDay', 'activityDay']) assert.equal(c.state[field], selected);
  for (const period of ['week', 'month', 'day']) {
    c.state.series = [{ at: selected, value: 50 }];
    c.selectDay('trends', selected);
    await listeners.click({ target: { closest: () => ({ dataset: { action: 'range', range: period } }) } });
    assert.equal(c.state.period, period);
    assert.equal(c.state.periodAnchor, selected);
    assert.equal(c.history.state.zhixi.period, period);
    assert.equal(c.state.trendDay, period === 'day' ? null : selected);
    for (const field of ['sleepDay', 'reviewDay', 'activityDay']) assert.equal(c.state[field], null);
  }
  const before = c.renderCount;
  for (const period of ['year', '7', '28', '90', '']) {
    await listeners.click({ target: { closest: () => ({ dataset: { action: 'range', range: period } }) } });
  }
  assert.equal(c.renderCount, before, '未知粒度和旧数字范围不改变状态');
});

test('四模块缩小粒度跟随所选日期；未选历史周期用末日，当前周期继续跟随今天', async () => {
  const selected = new Date(2026, 9, 31).getTime();
  for (const [view, field] of [['trends', 'trendDay'], ['sleep', 'sleepDay'], ['review', 'reviewDay'], ['activity', 'activityDay']]) {
    const { context: c, listeners } = harness();
    c.state.view = view; c.state.period = 'month'; c.state.periodAnchor = new Date(2026, 9, 1).getTime();
    c.state[field] = selected;
    await listeners.click({ target: { closest: () => ({ dataset: { action: 'range', range: 'day' } }) } });
    assert.equal(c.state.periodAnchor, selected, `${view} 月末详情切到日视图不跳回月初`);
    assert.equal(c.history.state.zhixi.periodAnchor, selected);
    for (const key of Object.values(c.dayFields)) assert.equal(c.state[key], key === field && view !== 'trends' ? selected : null);
  }
  const { context: c, listeners } = harness();
  const range = period => listeners.click({ target: { closest: () => ({ dataset: { action: 'range', range: period } }) } });
  c.state.view = 'trends'; c.state.period = 'day'; c.state.periodAnchor = selected;
  c.state.trendDay = selected + 15 * 3600000;
  await range('week'); assert.equal(c.state.periodAnchor, selected, '小时测量时间归本地日期锚点');
  c.state.period = 'month'; c.state.periodAnchor = new Date(2026, 9, 1).getTime(); c.state.trendDay = null;
  await range('day'); assert.equal(c.state.periodAnchor, selected, '历史月未显式选点时打开该月最后一天');
  c.state.period = 'week'; c.state.periodAnchor = new Date(2026, 9, 26).getTime();
  await range('day'); assert.equal(c.state.periodAnchor, new Date(2026, 10, 1).getTime(), '历史周跨月仍用该周最后一天');
  for (const [from, to] of [['day', 'week'], ['week', 'month'], ['month', 'day']]) {
    c.state.period = from; c.state.periodAnchor = null; c.state.trendDay = null;
    await range(to); assert.equal(c.state.periodAnchor, null, '当前周期没有指定日期时继续跟随今天');
  }
  c.state.period = 'month'; c.state.periodAnchor = null; c.state.trendDay = new Date(2026, 10, 5).getTime();
  await range('day'); assert.equal(c.state.periodAnchor, new Date(2026, 10, 5).getTime(), '当前月明确选中历史日则保留该日');
  const october25 = new Date(2026, 9, 25).getTime();
  c.state.period = 'day'; c.state.periodAnchor = october25; c.state.trendDay = null;
  await range('month');
  assert.equal(c.state.periodAnchor, october25); assert.equal(c.state.trendDay, october25, '历史日切到月保持详情日期，不自动跳到月末');
  c.state.view = 'activity'; c.state.period = 'week'; c.state.activityDay = null;
  await range('month'); assert.equal(c.state.activityDay, null, '活动全部日期模式切换粒度后仍显示全部');
});

test('首页进入演示回到总结顶部，其他页面开启演示保留滚动上下文', async () => {
  const { context: c, listeners } = harness(), scrolls = [];
  c.worker = null; c.demoData = () => ({ records: [], journal: [] });
  c.root.querySelector('main').scrollTo = value => scrolls.push(value.top);
  const startDemo = () => listeners.click({ target: { closest: () => ({ dataset: { action: 'demo-start' } }) } });
  await startDemo();
  assert.equal(c.state.mode, 'demo'); assert.equal(c.renderIntents.at(-1), 'data');
  assert.deepEqual(scrolls, [0]);
  c.state.view = 'data'; await startDemo();
  assert.deepEqual(scrolls, [0]);
});

test('前后周期不越过当前，回到当前清除选择，切换周期只替换历史条目', async () => {
  const { context: c, listeners, entries } = harness();
  const click = dataset => listeners.click({ target: { closest: () => ({ dataset }) } });
  for (const period of ['day', 'week', 'month']) {
    c.state.period = period; c.state.periodAnchor = null;
    const current = calendarPeriod(period, null, fixedNow), before = c.renderCount;
    await click({ action: 'period-step', direction: 'next' });
    await click({ action: 'period-step', direction: 'invalid' });
    assert.equal(c.renderCount, before); assert.equal(c.state.periodAnchor, null);
    c.state.trendDay = fixedNow;
    await click({ action: 'period-step', direction: 'previous' });
    assert.equal(c.state.periodAnchor, current.previous);
    assert.equal(c.history.state.zhixi.periodAnchor, current.previous);
    assert.equal(c.state.trendDay, null);
    assert.equal(c.renderIntents.at(-1), 'filter');
    await click({ action: 'period-step', direction: 'next' });
    assert.equal(c.state.periodAnchor, current.start);
    const backAtCurrent = c.renderCount;
    await click({ action: 'period-step', direction: 'next' });
    assert.equal(c.renderCount, backAtCurrent);
    await click({ action: 'period-step', direction: 'previous' });
    c.state.sleepDay = current.previous;
    await click({ action: 'period-today' });
    assert.equal(c.state.periodAnchor, null); assert.equal(c.state.period, period);
    assert.ok(Object.values(c.dayFields).every(field => c.state[field] === null));
    assert.equal(c.history.state.zhixi.periodAnchor, null);
  }
  assert.equal(entries.length, 1, '周期筛选不堆积浏览器后退记录');
});

test('前进后退恢复日周月及历史锚点，非法历史锚点回当前', () => {
  const { context: c, history } = harness();
  c.navigate('trends');
  c.state.period = 'month'; c.selectPeriodDate('2026-10-31');
  const anchor = c.state.periodAnchor;
  c.navigate('sleep');
  c.state.period = 'week'; c.selectPeriodDate('2026-11-16');
  history.back();
  assert.equal(c.state.view, 'trends'); assert.equal(c.state.period, 'month'); assert.equal(c.state.periodAnchor, anchor);
  history.forward();
  assert.equal(c.state.view, 'sleep'); assert.equal(c.state.period, 'week'); assert.equal(c.state.periodAnchor, new Date(2026, 10, 16).getTime());
  for (const invalid of [fixedNow + 1, -1, NaN, '2026-10-31', Infinity]) {
    c.restoreNavigation({ state: { zhixi: { view: 'trends', period: 'day', periodAnchor: invalid } } });
    assert.equal(c.state.period, 'day'); assert.equal(c.state.periodAnchor, null);
  }
});

test('首页今日指标和睡眠入口打开今日详情，趋势主导航及二级入口保留原周期', () => {
  for (const [view, options] of [['trends', { metric: 'hrv' }], ['sleep', {}]]) {
    const { context: c, history } = harness();
    const historical = new Date(2026, 9, 31).getTime();
    c.state.period = 'month'; c.state.periodAnchor = historical;
    c.state.trendDay = historical; c.state.sleepDay = historical;
    c.writeNavigation(true);
    c.navigate(view, options);
    assert.equal(c.state.period, 'day'); assert.equal(c.state.periodAnchor, null);
    assert.equal(c.state.trendDay, null); assert.equal(c.state.sleepDay, null);
    assert.equal(history.state.zhixi.period, 'day'); assert.equal(history.state.zhixi.periodAnchor, null);
    history.back();
    assert.equal(c.state.view, 'overview'); assert.equal(c.state.period, 'month'); assert.equal(c.state.periodAnchor, historical);
    history.forward();
    assert.equal(c.state.view, view); assert.equal(c.state.period, 'day'); assert.equal(c.state.periodAnchor, null);
  }
  const { context: c } = harness();
  const historical = new Date(2026, 9, 31).getTime();
  c.state.period = 'month'; c.state.periodAnchor = historical;
  c.navigate('trends', { primary: true });
  assert.equal(c.state.period, 'month'); assert.equal(c.state.periodAnchor, historical);
  c.navigate('trends', { metric: 'steps' });
  assert.equal(c.state.period, 'month'); assert.equal(c.state.periodAnchor, historical);
  c.navigate('sleep');
  assert.equal(c.state.period, 'month'); assert.equal(c.state.periodAnchor, historical);
});

test('日期条仅水平移动选中日期，不改变主内容滚动', () => {
  const { context: c } = harness();
  const calls = [];
  const strip = { clientWidth: 200, scrollLeft: 100, getBoundingClientRect: () => ({ left: 0, right: 200 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 240, right: 280, width: 40 }) }), scrollTo: value => calls.push(value) };
  c.root.querySelectorAll = () => [strip];
  c.revealSelectedDays(); assert.equal(calls[0].left, 260); assert.equal('top' in calls[0], false);
  strip.querySelector = () => ({ getBoundingClientRect: () => ({ left: 70, right: 110, width: 40 }) });
  c.revealSelectedDays(); assert.equal(calls.length, 1, '已可见时不改变横向位置');
});

test('触摸曲线按实际显示尺寸选日，空日仍可选；范围控件提交合法索引', () => {
  const { context: c, listeners } = harness();
  c.state.view = 'trends'; c.state.series = [{ at: 100, day: 'a', value: 8 }, { at: 200, day: 'b', value: null }, { at: 300, day: 'c', value: 9 }];
  const chart = { getBoundingClientRect: () => ({ left: 10, width: 680 }) };
  c.selectChartDay(chart, 10 + (38 + 145) * 2); assert.equal(c.state.trendDay, 200);
  c.selectChartDay(chart, -50); assert.equal(c.state.trendDay, 100);
  c.selectChartDay(chart, 9999); assert.equal(c.state.trendDay, 300);
  c.selectChartDay(chart, NaN); assert.equal(c.state.trendDay, 300);
  const input = { id: 'trend-position', value: '1', attrs: {}, closest: () => null, setAttribute(name, value) { this.attrs[name] = value; } };
  listeners.input({ target: input }); assert.equal(input.attrs['aria-valuetext'], 'b');
  listeners.change({ target: input }); assert.equal(c.state.trendDay, 200);
  input.value = '15'; listeners.change({ target: input }); assert.equal(c.state.trendDay, 200);
});

test('成功保存清除草稿并回记录列表，错误保留内容与草稿', async () => {
  const { context: c, listeners, form, values } = harness();
  c.state.mode = 'demo'; c.renderedMode = 'demo'; c.state.view = 'entry';
  c.captureEntryDraft();
  form.id = 'journal-form';
  const event = { target: form, preventDefault() {} };
  c.journalEntry = () => { throw new Error('无效输入'); };
  await listeners.submit(event);
  assert.equal(c.state.view, 'entry'); assert.equal(c.state.entryDraft.value, '3'); assert.equal(values.note, '保留感受');
  c.journalEntry = fields => ({ ...fields, id: 'saved' });
  await listeners.submit(event);
  assert.equal(c.state.view, 'journal'); assert.equal(c.state.entryDraft, null); assert.equal(c.state.journal.length, 1);
});

test('更正先完整校验，复用原编号只替换原条目，满容量仍能保存', async () => {
  const { context: c, listeners, form, values } = harness();
  const now = new Date(2026, 10, 17, 12).getTime();
  c.journalEntry = fields => journalEntry(fields, now);
  c.state.mode = 'demo'; c.renderedMode = 'demo'; c.state.view = 'journal';
  c.state.journal = Array.from({ length: 10000 }, (_, i) => ({ id: `entry-${i}`, kind: 'mood', value: 3, note: '原始感受', at: now - 3600000 + 32123 }));
  const untouched = c.state.journal[1];
  await listeners.click({ target: { closest: () => ({ dataset: { action: 'journal-edit', id: 'entry-0' } }) } });
  assert.equal(c.state.view, 'entry'); assert.equal(c.state.editingId, 'entry-0');
  assert.equal(c.state.entryDraft.at, '2026-11-17T11:00');
  Object.assign(values, c.state.entryDraft, { value: '9', note: '修改感受' }); form.id = 'journal-form';
  c.captureEntryDraft();
  await listeners.submit({ target: form, preventDefault() {} });
  assert.equal(c.state.view, 'entry'); assert.equal(c.state.editingId, 'entry-0');
  assert.equal(c.state.journal[0].note, '原始感受'); assert.equal(c.state.entryDraft.note, '修改感受');
  values.value = '5';
  await listeners.submit({ target: form, preventDefault() {} });
  assert.equal(c.state.journal.length, 10000); assert.equal(c.state.journal[0].id, 'entry-0');
  assert.equal(c.state.journal[0].value, 5); assert.equal(c.state.journal[0].note, '修改感受');
  assert.equal(c.state.journal[0].at, now - 3600000 + 32123);
  assert.equal(c.state.journal[1], untouched); assert.equal(c.state.editingId, null); assert.equal(c.state.entryDraft, null);
});

test('更正上下文随草稿保留，显式新建和模式切换清除；原记录消失不得重新创建', async () => {
  const { context: c, listeners, form } = harness();
  c.state.view = 'journal'; c.state.journal = [{ id: 'edit-me', kind: 'water', value: 250, note: '旧备注', at: new Date(2026, 10, 17, 10).getTime() }];
  c.editJournal('edit-me'); c.navigate('journal', { primary: true }); c.navigate('entry');
  assert.equal(c.state.editingId, 'edit-me');
  c.navigate('journal', { primary: true }); c.navigate('entry', { entryKind: 'water' });
  assert.equal(c.state.editingId, null); assert.equal(c.state.entryDraft.kind, 'water'); assert.equal(c.state.entryDraft.value, '');
  assert.equal(c.state.entryDraft.note, undefined, '从编辑显式新建不复用原记录备注和时间');
  c.state.mode = 'demo'; c.state.editingId = 'missing'; c.renderedMode = 'demo'; form.id = 'journal-form';
  const before = c.state.journal.length;
  await listeners.submit({ target: form, preventDefault() {} });
  assert.equal(c.state.journal.length, before); assert.equal(c.state.view, 'entry'); assert.equal(c.state.editingId, 'missing');
  c.showReal(); assert.equal(c.state.editingId, null); assert.equal(c.state.entryDraft, null);
});

test('真实保存前重新核对本机原记录，已被其他窗口删除时不执行 upsert', async () => {
  const { context: c, listeners, form } = harness();
  c.state.view = 'entry'; c.state.editingId = 'deleted-in-storage';
  c.state.journal = [{ id: 'deleted-in-storage', kind: 'mood', value: 3, at: 1 }];
  c.db = {}; c.state.storageReady = true; c.loadData = async () => ({ records: [], journal: [] });
  let writes = 0; c.putJournalEntry = async () => { writes++; };
  form.id = 'journal-form';
  await listeners.submit({ target: form, preventDefault() {} });
  assert.equal(writes, 0); assert.equal(c.state.view, 'entry'); assert.equal(c.state.editingId, 'deleted-in-storage');
  assert.equal(c.state.journal.length, 1);
});

test('导航明确区分进入、返回、主导航和同页，前进后退不增加历史', () => {
  const { context: c, history, entries } = harness();
  c.navigate('recovery'); assert.equal(c.renderIntents.at(-1), 'forward');
  c.navigate('trends'); assert.equal(c.renderIntents.at(-1), 'forward');
  history.back(); assert.equal(c.renderIntents.at(-1), 'back');
  history.forward(); assert.equal(c.renderIntents.at(-1), 'forward');
  assert.equal(entries.length, 3);
  c.navigate('journal', { primary: true }); assert.equal(c.renderIntents.at(-1), 'tab');
  const length = entries.length;
  c.navigate('journal', { primary: true }); assert.equal(c.renderIntents.at(-1), 'none');
  assert.equal(entries.length, length);
});

test('同一日期和同一时间范围不重绘，不重复播放选择反馈', async () => {
  const { context: c, listeners } = harness();
  const at = new Date(2026, 10, 16).getTime();
  c.state.series = [{ at, day: '2026-11-16', value: null }];
  c.selectDay('trends', String(at)); assert.equal(c.renderIntents.at(-1), 'day');
  const before = c.renderCount;
  c.selectDay('trends', '2026-11-16'); c.selectDay('trends', String(at));
  assert.equal(c.renderCount, before);
  c.state.activityDay = null; c.selectDay('activity', 'all'); assert.equal(c.renderCount, before);
  const range = value => listeners.click({ target: { closest: () => ({ dataset: { action: 'range', range: String(value) } }) } });
  await range('day'); assert.equal(c.renderCount, before);
  await range('week'); assert.equal(c.renderIntents.at(-1), 'filter');
  await range('week'); assert.equal(c.renderCount, before + 1);
});

test('分级内容未变化不重复播放，静默重绘不播放，跨档才给反馈', () => {
  const { context: c, fields, preview } = harness();
  c.renderEntryGrade = renderEntryGrade;
  fields.kind.value = 'water'; fields.value.value = '150';
  c.updateEntryGrade(); assert.equal(c.motionCalls.length, 0);
  const sameGrade = preview.innerHTML;
  fields.value.value = '250'; c.updateEntryGrade(true);
  assert.equal(preview.innerHTML, sameGrade, '同一真实分档使用相同解释和美术');
  assert.equal(c.motionCalls.length, 0);
  fields.value.value = '1500'; c.updateEntryGrade(true);
  assert.equal(c.motionCalls.length, 1); assert.equal(c.motionCalls[0][0], preview);
  c.updateEntryGrade(true); assert.equal(c.motionCalls.length, 1);
  fields.kind.value = 'caffeine'; fields.value.value = '0'; c.updateEntryGrade();
  assert.equal(c.motionCalls.length, 1, '整页恢复分级预览不额外播放');
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function pendingSave() {
  const h = harness(), c = h.context, write = deferred();
  c.navigate('entry', { entryKind: 'mood' });
  c.db = {}; c.state.storageReady = true;
  const saved = [];
  c.putJournalEntry = async (_db, entry) => { saved.push(entry); await write.promise; };
  c.loadData = async () => ({ records: [], journal: saved, lastImport: null });
  const event = { target: h.form, preventDefault() {} };
  const saving = h.listeners.submit(event);
  return { ...h, write, saved, event, saving };
}

test('慢保存立即禁用全部表单控件，阻止重复提交，成功后恢复按钮和忙态', async () => {
  const h = pendingSave(), c = h.context;
  const label = h.submit.querySelector('.submit-label'), icon = h.submit.querySelector('svg');
  assert.ok(label); assert.ok(icon);
  assert.equal(c.busy, true); assert.equal(c.journalSaving, true); assert.equal(h.form.attrs['aria-busy'], 'true');
  assert.ok(h.form.elements.every(field => field.disabled));
  assert.equal(h.submit.textContent, '正在保存…'); assert.equal(h.submit.attrs['aria-busy'], 'true');
  assert.deepEqual(Object.fromEntries(new c.FormData(h.form)), {}, 'mock 保留原生 FormData 排除 disabled 控件的行为');
  await h.listeners.submit(h.event); assert.equal(h.saved.length, 1);
  assert.equal(c.state.journal.length, 0, '异步保存结束前不提前修改显示数据');
  h.write.resolve(); await h.saving;
  assert.equal(c.busy, false); assert.equal(c.journalSaving, false); assert.equal(h.form.attrs['aria-busy'], 'false');
  assert.ok(h.form.elements.every(field => !field.disabled)); assert.equal(h.submit.textContent, '保存记录');
  assert.equal(h.submit.querySelector('.submit-label'), label); assert.equal(h.submit.querySelector('svg'), icon);
  assert.equal(c.state.view, 'journal'); assert.equal(c.state.entryDraft, null); assert.equal(c.state.journal.length, 1);
});

test('慢保存失败解锁原表单并保留草稿，错误说明获得焦点', async () => {
  const h = pendingSave(), c = h.context;
  h.write.reject(new Error('模拟空间不足')); await h.saving;
  assert.equal(c.busy, false); assert.equal(c.state.view, 'entry'); assert.equal(c.state.journal.length, 0);
  assert.equal(c.state.entryDraft.value, '3'); assert.equal(c.state.entryDraft.note, '保留感受');
  assert.equal(h.values.value, '3'); assert.ok(h.form.elements.every(field => !field.disabled));
  assert.equal(h.submit.textContent, '保存记录'); assert.equal(h.feedback.textContent, '模拟空间不足');
  assert.equal(h.feedback.focusCount, 1);
});

test('慢保存期间浏览器返回后成功保留当前页面，不强制回记录列表', async () => {
  const h = pendingSave(), c = h.context;
  h.history.back(); assert.equal(c.state.view, 'overview'); assert.equal(h.form.isConnected, false);
  assert.equal(c.state.entryDraft.value, '3', 'disabled 表单不能覆盖提交前的草稿');
  h.write.resolve(); await h.saving;
  assert.equal(c.state.view, 'overview'); assert.equal(c.state.journal.length, 1);
  assert.equal(h.history.state.zhixi.view, 'overview'); assert.equal(c.state.entryDraft, null);
  assert.equal(c.notices.at(-1).tone, 'success'); assert.equal(c.notices.at(-1).view, 'overview');
});

test('慢保存期间浏览器返回后失败在当前页面通知，草稿保持完整', async () => {
  const h = pendingSave(), c = h.context;
  h.history.back(); h.write.reject(new Error('模拟事务中止')); await h.saving;
  assert.equal(c.state.view, 'overview'); assert.equal(c.state.journal.length, 0);
  assert.equal(c.state.entryDraft.value, '3'); assert.equal(c.state.entryDraft.note, '保留感受');
  assert.equal(c.notices.at(-1).tone, 'error'); assert.equal(c.notices.at(-1).view, 'overview');
  assert.match(c.notices.at(-1).message, /记录未保存：模拟事务中止/);
  assert.equal(h.feedback.focusCount, 0, '不向脱离页面的表单放入或聚焦错误');
  assert.equal(c.busy, false); assert.ok(h.form.elements.every(field => !field.disabled));
});

test('保存期间返回又前进的新表单也会在完成时解锁', async () => {
  const h = pendingSave(), c = h.context;
  h.history.back(); h.history.forward();
  h.form.isConnected = false;
  const controls = [{ disabled: true }], submit = submitButton('正在保存…');
  submit.disabled = true; submit.dataset.idleLabel = '保存记录';
  const replacement = { elements: [...controls, submit], setAttribute() {}, querySelector: selector => selector === '[type="submit"]' ? submit : null };
  const query = c.root.querySelector;
  c.root.querySelector = selector => selector === '#journal-form' ? replacement : query(selector);
  h.write.reject(new Error('模拟保存失败')); await h.saving;
  assert.equal(c.state.view, 'entry'); assert.ok(replacement.elements.every(field => !field.disabled));
  assert.equal(submit.textContent, '保存记录'); assert.equal(c.state.entryDraft.value, '3');
  assert.equal(c.notices.at(-1).view, 'entry');
});

test('重复开启忙态只改按钮文字，解除时恢复原文并保留原 SVG 和 label 节点', () => {
  const { context: c, form, submit } = harness();
  const label = submit.querySelector('.submit-label'), icon = submit.querySelector('svg');
  label.textContent = '保存更正';
  c.setFormBusy(form, true); c.setFormBusy(form, true);
  assert.equal(submit.dataset.idleLabel, '保存更正'); assert.equal(label.textContent, '正在保存…');
  assert.equal(submit.querySelector('svg'), icon); assert.equal(submit.querySelector('.submit-label'), label);
  c.setFormBusy(form, false);
  assert.equal(label.textContent, '保存更正'); assert.equal(submit.querySelector('svg'), icon);
  assert.equal(submit.children.length, 2); assert.ok(form.elements.every(field => !field.disabled));
  assert.equal(form.attrs['aria-busy'], 'false'); assert.equal(submit.attrs['aria-busy'], 'false');
});

test('导入导出的一般 busy 不阻止捕获草稿，只有日志保存时保留提交快照', () => {
  const { context: c, values, form } = harness();
  c.state.view = 'entry'; c.busy = true; c.journalSaving = false;
  values.value = '4'; values.note = '一般忙态中可继续写草稿';
  c.captureEntryDraft();
  assert.equal(c.state.entryDraft.value, '4'); assert.equal(c.state.entryDraft.note, values.note);
  c.journalSaving = true; c.setFormBusy(form, true);
  c.captureEntryDraft();
  assert.equal(c.state.entryDraft.value, '4', '日志保存时不读取 disabled FormData 覆盖提交快照');
});
