// 仅用于浏览器布局验收，不模拟 HealthKit 授权或读取成功。
import { renderApp } from '../views.mjs';
import { analyze, hourlySeries, dailySeries, calendarPeriod, sleepSeries, recoveryReport, workoutReport, personalBands } from '../core.mjs';
import { journalReport } from '../model.mjs';
import { demoData } from '../demo.mjs';

const params = new URLSearchParams(location.search), now = Date.now();
const ready = params.get('case') === 'ready', error = params.get('case') === 'error';
const records = ready ? demoData(now).records : [], journal = [];
const window = calendarPeriod('day', null, now), options = { now: window.through, days: window.days };
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const state = {
  view: params.get('view') === 'data' ? 'data' : 'overview', theme: document.documentElement.dataset.theme,
  mode: 'real', records, journal, now, source: 'auto', period: 'day', periodAnchor: null, window, metric: 'hrv',
  analysis: analyze(records, { now }), series: hourlySeries(records, 'hrv', options), sleeps: sleepSeries(records, options),
  sources: [...new Set(records.filter(r => r.type === 'hrv').map(r => r.source))],
  recovery: recoveryReport(records, { now }), workouts: workoutReport(records, options), journalReport: journalReport(journal, options),
  reviewHrv: dailySeries(records, 'hrv', options), reviewSleep: sleepSeries(records, options), bands: personalBands(records, { now }),
  storageReady: true, storageError: '', lastImport: null, breathing: { running: false, elapsed: 0 },
  notice: '仅界面预览 · 数据虚构 · 未连接 Apple 健康', noticeTone: 'neutral',
  native: { available: true, accessRequested: ready || error, isLoading: false, lastLoadedAt: ready ? now : null,
    historyStart: ready ? now - 90 * 86400000 : null, message: error ? '健康记录暂时不可读，请解锁 iPhone 后刷新。' : null,
    backgroundMessage: null, records }, nativeBusy: false,
};
const root = document.querySelector('#app');
root.innerHTML = renderApp(state);
root.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'navigate') {
    state.view = button.dataset.view;
    if (button.dataset.metric) { state.metric = button.dataset.metric; state.series = hourlySeries(records, state.metric, options); }
  } else if (button.dataset.action === 'theme-toggle') {
    state.theme = state.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = state.theme;
  } else state.notice = '这是 UI 预览；真实系统授权、健康读取和保存需在 iPhone 验收。';
  root.innerHTML = renderApp(state);
});
