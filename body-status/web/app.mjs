import { analyze, dailySeries, hourlySeries, calendarPeriod, sleepSeries, recoveryReport, workoutReport, personalBands } from './core.mjs';
import { renderApp, renderEntryGrade, renderEntryOptions } from './views.mjs';
import { demoData } from './demo.mjs';
import { openDatabase, loadData, saveData, importData, putJournalEntry, deleteJournalEntry } from './storage.mjs';
import { journalEntry, journalReport } from './model.mjs';
import { nativeBridge, emptyNative, healthSnapshot } from './native.mjs';

const root = document.querySelector('#app');
const fileInput = document.querySelector('#health-file');
let real = { records: [], journal: [], lastImport: null };
let db, worker, frame, breatheStart = 0, busy = false, journalSaving = false;
let analysisCache = {}, seriesCache = {}, sleepCache = {}, sourcesRecords;
let recoveryCache = {}, workoutCache = {}, journalCache = {}, reviewCache = {};
let bandsCache = {};
let renderedMode, navigationTrail = [];
const nativeRequest = nativeBridge();
let nativePending = false;
const views = ['overview', 'trends', 'sleep', 'journal', 'entry', 'breathe', 'data', 'recovery', 'activity', 'review'];
const entryKinds = ['mood', 'water', 'caffeine', 'note'];
const dayFields = { trends: 'trendDay', sleep: 'sleepDay', review: 'reviewDay', activity: 'activityDay' };
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const activeMotion = new Map();
const entryGrades = new WeakMap();
const motionEase = 'cubic-bezier(0.16, 1, 0.3, 1)';
let theme = 'light';
try { if (localStorage.getItem('zhixi-theme') === 'dark') theme = 'dark'; } catch {}
document.documentElement.dataset.theme = theme;
const state = {
  theme,
  view: 'overview', mode: 'real', source: 'auto', period: 'day', periodAnchor: null, metric: 'hrv',
  records: [], journal: [], now: Date.now(), sources: [],
  importStatus: null, importPreview: null, notice: '', noticeTone: 'neutral', noticeEnter: false, storageReady: false,
  storageError: '', lastImport: null, breathing: { running: false, elapsed: 0 },
  backView: null, entryDraft: null, editingId: null, trendDay: null, sleepDay: null, reviewDay: null, activityDay: null,
  native: nativeRequest ? emptyNative() : null, nativeBusy: false,
};

function captureEntryDraft() {
  const form = state.view === 'entry' && renderedMode === state.mode ? root.querySelector('#journal-form') : null;
  if (form && !journalSaving) state.entryDraft = Object.fromEntries(new FormData(form));
}

function stopUiMotion() {
  for (const animation of activeMotion.values()) animation.cancel();
  activeMotion.clear();
}

function playMotion(element, frames, duration = 200, delay = 0) {
  if (!element?.animate || motionPreference.matches || document.hidden) return;
  activeMotion.get(element)?.cancel();
  const animation = element.animate(frames, { duration, delay, easing: motionEase, fill: 'backwards' });
  animation.id = 'zhixi-feedback';
  activeMotion.set(element, animation);
  const release = () => { if (activeMotion.get(element) === animation) activeMotion.delete(element); };
  animation.finished.then(release, release);
}

function visibleMotionElements(elements) {
  const viewport = root.querySelector('main')?.getBoundingClientRect();
  if (!viewport) return [];
  const visible = [];
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.height && rect.bottom > viewport.top && rect.top < viewport.bottom) visible.push(element);
    if (visible.length === 6) break;
  }
  return visible;
}

function captureUiMotion(intent) {
  if (intent === 'none' || motionPreference.matches) return null;
  return {
    view: root.querySelector('.app-shell')?.dataset.view,
    marker: root.querySelector('.nav-marker')?.getBoundingClientRect().left,
    rows: new Map(visibleMotionElements(root.querySelectorAll('.journal-entry')).map(row => [row.dataset.entryId, row.getBoundingClientRect().top])),
  };
}

function animateUiRender(before, intent) {
  if (!before || motionPreference.matches) return;
  const marker = root.querySelector('.nav-marker');
  const delta = marker && Number.isFinite(before.marker) ? before.marker - marker.getBoundingClientRect().left : 0;
  if (delta) playMotion(marker, [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }], 240);
  if (before.view !== state.view) {
    const direction = intent === 'back' || (intent === 'tab' && delta > 0) ? -1 : 1;
    playMotion(root.querySelector('main'), [{ opacity: .55, transform: `translateX(${direction * 12}px)` }, { opacity: 1, transform: 'translateX(0)' }], 220);
    return;
  }
  const selectors = {
    overview: '.signal-hero, .metrics-grid', trends: '.trend-focus, .trend-panel > .grade-panel',
    sleep: '.sleep-summary', recovery: '.recovery-item', activity: '.activity-day-summary, .workout-detail',
    review: '.review-day', journal: '.journal-today, .journal-entry', data: '.profile-summary, .coverage-panel',
    breathe: '.breath-orb',
  };
  const selector = intent === 'import' ? '.import-panel' : selectors[state.view];
  if (!selector) return;
  visibleMotionElements(root.querySelectorAll(selector)).forEach((element, index) => {
    const oldTop = before.rows.get(element.dataset.entryId);
    const offset = oldTop === undefined ? 0 : oldTop - element.getBoundingClientRect().top;
    if (offset) playMotion(element, [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], 220);
    else playMotion(element, [{ opacity: .55 }, { opacity: 1 }], 180, index * 38);
  });
}

function animateDisclosure(summary) {
  const details = summary.parentElement;
  if (motionPreference.matches || !details || details.tagName !== 'DETAILS') return;
  const wasOpen = details.open;
  const siblings = [...details.parentElement.children].filter(element => element !== details);
  const positions = siblings.map(element => [element, element.getBoundingClientRect().top]);
  requestAnimationFrame(() => {
    if (!details.isConnected || details.open === wasOpen) return;
    if (details.open) visibleMotionElements([...details.children].filter(element => element !== summary)).forEach(element => {
      playMotion(element, [{ opacity: .5, clipPath: 'inset(0 0 12% 0)' }, { opacity: 1, clipPath: 'inset(0)' }], 200);
    });
    else playMotion(summary, [{ opacity: .65 }, { opacity: 1 }], 140);
    const visible = new Set(visibleMotionElements(siblings));
    for (const [element, top] of positions) {
      const delta = top - element.getBoundingClientRect().top;
      // 大段详情不做全距离补位，避免记录行越过已展开的正文。
      const offset = Math.sign(delta) * Math.min(8, Math.abs(delta));
      if (delta && visible.has(element)) playMotion(element, [{ opacity: .65, transform: `translateY(${offset}px)` }, { opacity: 1, transform: 'translateY(0)' }], details.open ? 220 : 150);
    }
  });
}

function setFormBusy(form, value) {
  form.setAttribute('aria-busy', String(value));
  for (const field of form.elements) field.disabled = value;
  const submit = form.querySelector('[type="submit"]');
  if (!submit) return;
  const label = submit.querySelector('.submit-label');
  if (label && value) { submit.dataset.idleLabel ||= label.textContent; label.textContent = '正在保存…'; }
  else if (label && submit.dataset.idleLabel) label.textContent = submit.dataset.idleLabel;
  submit.setAttribute('aria-busy', String(value));
}

motionPreference.addEventListener('change', stopUiMotion);

function routeSnapshot() {
  return { view: state.view, metric: state.metric, period: state.period, periodAnchor: state.periodAnchor };
}

function writeNavigation(replace = false) {
  const saved = { zhixi: routeSnapshot(), trail: navigationTrail };
  history[replace ? 'replaceState' : 'pushState'](saved, '');
}

function prepareEntryKind(kind) {
  if (!entryKinds.includes(kind)) return;
  if (state.editingId) { state.editingId = null; state.entryDraft = null; }
  if (state.entryDraft?.kind !== kind) state.entryDraft = { ...state.entryDraft, kind, value: '' };
}

function editJournal(id) {
  const row = state.journal.find(item => item.id === id);
  if (!row) { notify('这条记录已不存在，请回到记录列表重新查看。', 'error'); return; }
  const date = new Date(row.at), pad = value => String(value).padStart(2, '0');
  state.entryDraft = { kind: row.kind, value: String(row.value), note: row.note || '',
    at: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}` };
  state.editingId = row.id;
  navigate('entry');
}

function navigate(view, { primary = false, metric, entryKind, replace = false } = {}) {
  if (!views.includes(view)) return;
  captureEntryDraft();
  const previous = routeSnapshot();
  if (state.view === 'overview' && (metric || view === 'sleep')) {
    state.period = 'day'; state.periodAnchor = null;
    state.trendDay = null; state.sleepDay = null;
  }
  if (primary) navigationTrail = [];
  else if (view !== state.view) navigationTrail.push(previous);
  if (['hrv', 'heartRate', 'restingHeartRate', 'steps', 'activeEnergy', 'respiratoryRate', 'oxygenSaturation'].includes(metric)) state.metric = metric;
  if (view === 'entry') prepareEntryKind(entryKind);
  stopBreathing(); state.view = view; state.backView = navigationTrail.at(-1)?.view || null; state.notice = '';
  writeNavigation(replace || previous.view === view);
  render(previous.view === view ? 'none' : primary ? 'tab' : 'forward');
  root.querySelector('main')?.scrollTo({ top: 0 });
  document.querySelector('main')?.focus({ preventScroll: true });
}

function restoreNavigation(event) {
  const route = event.state?.zhixi;
  if (!route || !views.includes(route.view)) return;
  const oldDepth = navigationTrail.length;
  captureEntryDraft(); stopBreathing();
  navigationTrail = Array.isArray(event.state.trail) ? event.state.trail.filter(item => views.includes(item?.view)) : [];
  state.view = route.view;
  if (['hrv', 'heartRate', 'restingHeartRate', 'steps', 'activeEnergy', 'respiratoryRate', 'oxygenSaturation'].includes(route.metric)) state.metric = route.metric;
  if (['day', 'week', 'month'].includes(route.period)) state.period = route.period;
  state.periodAnchor = Number.isFinite(route.periodAnchor) && route.periodAnchor >= 0 && route.periodAnchor <= Date.now() ? route.periodAnchor : null;
  state.backView = navigationTrail.at(-1)?.view || null; state.notice = '';
  render(navigationTrail.length < oldDepth ? 'back' : navigationTrail.length > oldDepth ? 'forward' : 'tab'); document.querySelector('main')?.focus({ preventScroll: true });
}

function daySeries(scope) {
  return { trends: state.series, sleep: state.sleeps, review: state.journalReport?.daily, activity: state.workouts?.daily }[scope] || [];
}

function selectDay(scope, value) {
  if (!Object.hasOwn(dayFields, scope)) return;
  if (scope === 'activity' && value === 'all') { if (state.activityDay === null) return; state.activityDay = null; render('day'); return; }
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const selected = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null;
  if (selected && (selected.getFullYear() !== Number(parts[1]) || selected.getMonth() !== Number(parts[2]) - 1 || selected.getDate() !== Number(parts[3]))) return;
  const at = selected ? selected.getTime() : Number(value);
  const item = daySeries(scope).find(day => day.at === at);
  if (!item || state[dayFields[scope]] === item.at) return;
  state[dayFields[scope]] = item.at;
  render('day');
}

function selectChartDay(chart, clientX) {
  if (state.view !== 'trends' || !state.series?.length || !Number.isFinite(clientX)) return;
  const rect = chart.getBoundingClientRect();
  if (!(rect.width > 0)) return;
  const position = Math.max(0, Math.min(1, ((clientX - rect.left) / rect.width * 340 - 38) / 290));
  selectDay('trends', state.series[Math.round(position * (state.series.length - 1))].at);
}

function selectPeriodDate(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!parts) return;
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (date.getFullYear() !== Number(parts[1]) || date.getMonth() !== Number(parts[2]) - 1 || date.getDate() !== Number(parts[3]) || +date < 0 || +date > Date.now()) return;
  state.periodAnchor = +date;
  for (const [scope, field] of Object.entries(dayFields)) state[field] = scope === 'trends' && state.period === 'day' ? null : +date;
  writeNavigation(true); render('filter');
}

function revealSelectedDays() {
  for (const strip of root.querySelectorAll('.date-strip')) {
    const selected = strip.querySelector('[aria-pressed="true"]');
    if (!selected || !strip.clientWidth) continue;
    const box = strip.getBoundingClientRect(), item = selected.getBoundingClientRect();
    if (item.left < box.left || item.right > box.right) strip.scrollTo({ left: strip.scrollLeft + item.left - box.left - (strip.clientWidth - item.width) / 2 });
  }
}

function render(intent = 'none') {
  const motionBefore = captureUiMotion(intent);
  stopUiMotion();
  const sameView = root.querySelector('.app-shell')?.dataset.view === state.view;
  const scrollTop = sameView ? root.querySelector('main')?.scrollTop || 0 : 0;
  const openDetails = sameView ? [...root.querySelectorAll('details[id][open]')].map(el => el.id) : [];
  const focusId = sameView ? document.activeElement?.id : '';
  const focusRange = sameView ? document.activeElement?.dataset.range : '';
  if (sameView) captureEntryDraft();
  const draft = state.view === 'entry' ? state.entryDraft : null;
  state.now = Date.now();
  state.window = calendarPeriod(state.period, state.periodAnchor, state.now);
  const periodOptions = { days: state.window.days, now: state.window.through };
  const periodKey = `${state.period}/${state.window.start}/${Math.floor(state.window.through / 60000)}`;
  const minute = Math.floor(state.now / 60000);
  const day = new Date(state.now).toDateString();
  if (bandsCache.records !== state.records || bandsCache.day !== day) {
    state.bands = personalBands(state.records, { now: state.now });
    bandsCache = { records: state.records, day };
  }
  if (analysisCache.records !== state.records || analysisCache.source !== state.source || analysisCache.minute !== minute) {
    state.analysis = analyze(state.records, { now: state.now, source: state.source });
    analysisCache = { records: state.records, source: state.source, minute };
  }
  if (state.view === 'recovery' || state.view === 'overview') {
    if (recoveryCache.records !== state.records || recoveryCache.source !== state.source || recoveryCache.minute !== minute) {
      state.recovery = recoveryReport(state.records, { now: state.now, source: state.source });
      recoveryCache = { records: state.records, source: state.source, minute };
    }
  }
  if (state.view === 'activity') {
    const key = periodKey;
    if (workoutCache.records !== state.records || workoutCache.key !== key) {
      state.workouts = workoutReport(state.records, periodOptions);
      workoutCache = { records: state.records, key };
    }
  }
  if (state.view === 'journal' || state.view === 'review') {
    const key = state.view === 'journal' ? `today/${minute}` : periodKey;
    if (journalCache.journal !== state.journal || journalCache.key !== key) {
      state.journalReport = journalReport(state.journal, state.view === 'journal' ? { days: 1, now: state.now } : periodOptions);
      journalCache = { journal: state.journal, key };
    }
  }
  if (state.view === 'review') {
    const key = `${periodKey}/${state.source}`;
    if (reviewCache.records !== state.records || reviewCache.key !== key) {
      state.reviewHrv = dailySeries(state.records, 'hrv', { ...periodOptions, source: state.source });
      state.reviewSleep = sleepSeries(state.records, periodOptions);
      reviewCache = { records: state.records, key };
    }
  }
  if (state.view === 'trends') {
    const source = state.metric === 'hrv' ? state.source : 'auto';
    const key = `${periodKey}/${state.metric}/${source}`;
    if (seriesCache.records !== state.records || seriesCache.key !== key) {
      state.series = (state.period === 'day' ? hourlySeries : dailySeries)(state.records, state.metric, { ...periodOptions, source });
      seriesCache = { records: state.records, key };
    }
  }
  if (state.view === 'sleep') {
    const key = periodKey;
    if (sleepCache.records !== state.records || sleepCache.key !== key) {
      state.sleeps = sleepSeries(state.records, periodOptions);
      sleepCache = { records: state.records, key };
    }
  }
  if (sourcesRecords !== state.records) {
    state.sources = [...new Set(state.records.filter(r => r.type === 'hrv').map(r => r.source))].sort();
    sourcesRecords = state.records;
  }
  const selectedField = dayFields[state.view];
  const days = daySeries(state.view);
  if (selectedField && state[selectedField] !== null && !days.some(day => day.at === state[selectedField])) state[selectedField] = days.at(-1)?.at ?? null;
  root.innerHTML = renderApp(state);
  renderedMode = state.mode;
  state.noticeEnter = false;
  for (const id of openDetails) { const details = document.getElementById(id); if (details) details.open = true; }
  if (draft) for (const [name, value] of Object.entries(draft)) {
    const field = root.querySelector('#journal-form')?.elements.namedItem(name);
    if (field) field.value = value;
  }
  updateEntryGrade();
  const focus = focusId ? document.getElementById(focusId) : focusRange ? root.querySelector(`[data-range="${focusRange}"]`) : null;
  focus?.focus({ preventScroll: true });
  root.querySelector('main')?.scrollTo({ top: scrollTop });
  revealSelectedDays();
  if (busy && state.importStatus) {
    const cancel = root.querySelector('[data-action="import-cancel"]');
    if (cancel) { cancel.disabled = true; cancel.textContent = '正在保存'; }
  }
  const savingForm = journalSaving && root.querySelector('#journal-form');
  if (savingForm) setFormBusy(savingForm, true);
  if (state.breathing.running) { cancelAnimationFrame(frame); updateBreathing(); }
  animateUiRender(motionBefore, intent);
}

function notify(message, tone = 'neutral') {
  state.notice = message;
  state.noticeTone = tone;
  state.noticeEnter = true;
  render(tone === 'success' ? 'result' : 'none');
}

function showReal() {
  if (state.mode !== 'real') { state.entryDraft = null; state.editingId = null; }
  const records = state.native ? state.native.records : real.records;
  const keepSource = state.mode === 'real' && (state.source === 'auto' || records.some(r => r.type === 'hrv' && r.source === state.source));
  state.mode = 'real'; state.records = records; state.journal = real.journal;
  state.lastImport = real.lastImport;
  if (!keepSource) state.source = 'auto';
}

async function syncNative(action = 'status') {
  if (!nativeRequest) return;
  if (state.nativeBusy) { if (action === 'status') nativePending = true; return; }
  captureEntryDraft(); state.nativeBusy = true; render();
  try {
    state.native = healthSnapshot(await nativeRequest(action));
    if (state.mode === 'real') showReal();
  } catch (error) {
    // 读取失败时不以旧记录冒充当前授权范围；日记与导入备份保持原样。
    state.native = { ...state.native, records: [], isLoading: false, error: error.message || String(error) };
    if (state.mode === 'real') showReal();
  } finally {
    captureEntryDraft(); state.nativeBusy = false; render();
    if (nativePending) { nativePending = false; void syncNative(); }
  }
}

function stopBreathing(completed = false) {
  cancelAnimationFrame(frame);
  state.breathing.running = false;
  state.breathing.elapsed = completed ? 60 : 0;
}

function updateBreathing() {
  if (!state.breathing.running) return;
  const elapsed = Math.min(60, (performance.now() - breatheStart) / 1000);
  state.breathing.elapsed = elapsed;
  const cycle = elapsed % 10;
  const inhale = cycle < 4;
  const phase = document.querySelector('#breath-phase');
  const count = document.querySelector('#breath-count');
  const orb = document.querySelector('#breath-orb');
  const progress = document.querySelector('#breath-progress');
  if (phase) phase.textContent = inhale ? '轻轻吸气' : '缓缓呼气';
  if (count) count.textContent = String(Math.ceil(inhale ? 4 - cycle : 10 - cycle));
  if (orb) {
    orb.dataset.phase = inhale ? 'inhale' : 'exhale';
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const amount = inhale ? cycle / 4 : 1 - (cycle - 4) / 6;
      orb.style.setProperty('--breath-fill', String(amount));
    }
  }
  if (progress) {
    if ('value' in progress) { progress.max = 60; progress.value = elapsed; }
    else progress.textContent = `${Math.floor(elapsed)} / 60 秒`;
  }
  if (elapsed >= 60) {
    stopBreathing(true); notify('一分钟练习已完成。按自己的舒适节奏恢复自然呼吸。', 'success');
  } else frame = requestAnimationFrame(updateBreathing);
}

function cancelImport() {
  worker?.terminate(); worker = null;
  state.importStatus = null; state.importPreview = null;
  fileInput.value = '';
}

async function importFile(file) {
  if (!file || busy) return;
  if (state.native && !file.name.toLowerCase().endsWith('.json')) { notify('原生版请选择知息 JSON 备份迁移日常记录。健康数据可直接连接 Apple 健康读取。'); return; }
  stopBreathing(); cancelImport(); showReal();
  state.notice = ''; state.importStatus = { percent: 0, message: '正在本机读取文件…' }; render('import');
  try {
    const activeWorker = worker = new Worker(new URL('./import-worker.mjs', import.meta.url), { type: 'module' });
    activeWorker.onmessage = ({ data }) => {
      if (worker !== activeWorker) return;
      if (data.type === 'progress') {
        state.importStatus = { percent: data.percent, message: data.message }; render();
      } else if (data.type === 'done') {
        state.importStatus = null;
        state.importPreview = state.native ? { ...data.result, records: [],
          warnings: [...(data.result.warnings || []), '原生版仅导入日常记录；健康记录由 Apple 健康直接读取。'] } : data.result;
        activeWorker.terminate(); worker = null;
        render('import');
      } else if (data.type === 'error') {
        cancelImport(); notify(`导入未保存：${data.message}`, 'error');
      }
    };
    activeWorker.onerror = () => { if (worker !== activeWorker) return; cancelImport(); notify(state.native ? '备份暂时无法读取。请保留原备份，重新打开知息后重试；原数据未变更。' : '导入器无法运行。请使用最新版 Safari、Chrome 或 Edge，并从本地服务地址打开。原数据未变更。', 'error'); };
    activeWorker.postMessage({ file });
  } catch (error) { cancelImport(); notify(`导入失败：${error.message}`, 'error'); }
}

async function commitImport() {
  if (!state.importPreview || busy) return;
  if (!db || !state.storageReady) { notify(state.native ? '本机存储不可用，日常记录尚未保存。请保留备份，重新打开知息并检查 iPhone 可用存储。' : '浏览器本地数据库不可用，无法保存。请退出无痕模式并重新打开。', 'error'); return; }
  busy = true;
  try {
    state.importStatus = { percent: 100, message: '正在保存到本机，请保持页面打开…' }; render();
    const result = await importData(db, state.native ? { ...state.importPreview, records: [] } : state.importPreview);
    real = { records: result.records, journal: result.journal, lastImport: result.lastImport }; showReal(); cancelImport();
    notify(state.native ? '日常记录已合并到本机。健康数据仍从 Apple 健康读取。' : `导入完成，新增 ${result.added.toLocaleString('zh-CN')} 条健康记录。重复记录已去重。`, 'success');
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (error) {
    state.importStatus = null;
    notify(`保存失败，原数据保留：${error.message}。${state.native ? '请保留备份并检查 iPhone 可用存储。' : '请先导出备份并检查浏览器可用空间。'}`, 'error');
  } finally { busy = false; }
}

async function exportBackup() {
  if (state.mode === 'demo') { notify('演示数据不参与备份。请退出演示后导出自己的数据。'); return; }
  if (!state.storageReady) { notify('本地数据尚未加载完成，请稍后重试。'); return; }
  busy = true;
  try {
    real = await loadData(db); showReal();
    const json = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), records: state.records, journal: real.journal });
    if (state.native) {
      const result = await nativeRequest('export', { json });
      notify(result.shared ? '备份已交给所选位置。文件包含健康和日常记录，请妥善保管。' : '已关闭分享，App 内的数据保持原样。', result.shared ? 'success' : 'neutral');
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `知息备份-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 30000);
    notify('备份已交给浏览器下载。文件包含健康和日志数据，请保存到你信任的位置。', 'success');
  } catch (error) { notify(`无法导出完整备份：${error.message}`, 'error'); }
  finally { busy = false; }
}

root.addEventListener('click', async event => {
  if (busy) return;
  const button = event.target.closest('[data-action]');
  if (!button) {
    const summary = event.target.closest('summary');
    if (summary) animateDisclosure(summary);
    const chart = event.target.closest('svg[data-chart-select]');
    if (chart) selectChartDay(chart, event.clientX);
    return;
  }
  const action = button.dataset.action;
  if (action === 'health-connect' || action === 'health-refresh') {
    await syncNative(action === 'health-connect' ? 'connect' : 'refresh');
  } else if (action === 'health-settings') {
    try { if (nativeRequest) await nativeRequest('settings'); }
    catch (error) { notify(`无法打开设置：${error.message || String(error)}`, 'error'); }
  } else if (action === 'theme-toggle') {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    button.querySelector('.theme-value').textContent = state.theme === 'dark' ? '开启' : '关闭';
    button.setAttribute('aria-pressed', String(state.theme === 'dark'));
    try { localStorage.setItem('zhixi-theme', state.theme); } catch {}
  } else if (action === 'navigate') {
    event.preventDefault();
    navigate(button.dataset.view, { primary: !!button.closest('.mobile-nav'), metric: button.dataset.metric, entryKind: button.dataset.entryKind });
  } else if (action === 'back') {
    if (navigationTrail.length && history.state?.zhixi) history.back();
    else navigate({ sleep: 'overview', breathe: 'overview', recovery: 'overview', activity: 'overview', entry: 'journal', review: 'journal' }[state.view] || 'overview', { primary: true, replace: true });
  } else if (action === 'day-select') {
    selectDay(button.dataset.scope, button.dataset.day);
  } else if (action === 'entry-value') {
    const input = root.querySelector('#entry-value');
    if (input) {
      input.value = button.dataset.value || '';
      input.closest('form')?.querySelector('[role="alert"]')?.remove();
      updateEntryGrade(true); captureEntryDraft();
    }
  } else if (action === 'entry-kind') {
    changeEntryKind(button.dataset.kind);
  } else if (action === 'journal-edit') {
    editJournal(button.dataset.id);
  } else if (action === 'demo-start') {
    if (worker || state.importPreview) { notify('请先完成或取消当前导入。'); return; }
    stopBreathing(); Object.assign(state, demoData()); state.mode = 'demo'; state.source = 'auto'; state.entryDraft = null; state.editingId = null;
    state.notice = ''; state.lastImport = null; render('data');
    if (state.view === 'overview') root.querySelector('main')?.scrollTo({ top: 0 });
  } else if (action === 'demo-exit') {
    stopBreathing();
    if (state.view === 'entry') state.view = 'journal';
    showReal(); state.notice = ''; navigationTrail = []; state.backView = null; writeNavigation(true); render('data');
  }
  else if (action === 'import-open') fileInput.click();
  else if (action === 'import-cancel') { cancelImport(); notify('已取消导入，原数据未变更。'); }
  else if (action === 'import-confirm') await commitImport();
  else if (action === 'export') await exportBackup();
  else if (action === 'range') {
    const period = button.dataset.range;
    if (['day', 'week', 'month'].includes(period) && period !== state.period) {
      const window = calendarPeriod(state.period, state.periodAnchor, Date.now());
      const selected = state[dayFields[state.view]];
      const anchor = new Date(Number.isFinite(selected) ? selected : window.through);
      anchor.setHours(0, 0, 0, 0);
      state.periodAnchor = Number.isFinite(selected) || !window.isCurrent ? +anchor : null;
      state.period = period;
      for (const field of Object.values(dayFields)) state[field] = null;
      const field = dayFields[state.view];
      if (field && !(state.view === 'trends' && period === 'day') && !(state.view === 'activity' && !Number.isFinite(selected))) state[field] = +anchor;
      writeNavigation(true); render('filter');
    }
  } else if (action === 'period-step') {
    const window = calendarPeriod(state.period, state.periodAnchor, Date.now());
    const anchor = button.dataset.direction === 'previous' ? window.previous : button.dataset.direction === 'next' ? window.next : null;
    if (anchor !== null && Number.isFinite(anchor) && anchor >= 0) {
      state.periodAnchor = anchor;
      for (const field of Object.values(dayFields)) state[field] = null;
      writeNavigation(true); render('filter');
    }
  } else if (action === 'period-today') {
    state.periodAnchor = null;
    for (const field of Object.values(dayFields)) state[field] = null;
    writeNavigation(true); render('filter');
  } else if (action === 'clear-data') {
    if (state.mode === 'demo') { notify('请先退出演示。演示数据不会保存到真实数据库。'); return; }
    if (!state.storageReady) { notify('本地存储尚未准备好。'); return; }
    if (!confirm(state.native ? '清除本 App 保存的日常记录与手动导入数据？此操作无法撤销，请先导出备份。Apple 健康中的数据和读取权限保持不变。' : '清除这个浏览器里的全部健康数据和生活记录？此操作无法撤销，请先导出备份。Apple 健康中的原始数据不会受影响。')) return;
    busy = true;
    try { await saveData(db, { records: [], journal: [], lastImport: null }); real = { records: [], journal: [], lastImport: null }; showReal(); notify(state.native ? '本 App 保存的记录已清除。Apple 健康数据仍按当前权限读取。' : '本机知息数据已清除。', 'success'); }
    catch (error) { notify(`清除失败：${error.message}`, 'error'); }
    finally { busy = false; }
  } else if (action === 'journal-delete') {
    if (!confirm('删除这条生活记录？')) return;
    const journal = state.journal.filter(entry => entry.id !== button.dataset.id);
    busy = true;
    try {
      if (state.mode === 'real') {
        if (!db) throw new Error('本地存储不可用');
        await deleteJournalEntry(db, button.dataset.id); real = await loadData(db); showReal();
      } else state.journal = journal;
      notify('记录已删除。', 'success');
    } catch (error) { notify(`删除失败：${error.message}`, 'error'); }
    finally { busy = false; }
  } else if (action === 'breathe-start') {
    stopBreathing(); state.breathing = { running: true, elapsed: 0 }; breatheStart = performance.now(); state.notice = ''; render('data');
  } else if (action === 'breathe-stop') { stopBreathing(); notify('已结束练习。'); }
});

root.addEventListener('change', event => {
  event.target.closest('#journal-form')?.querySelector('[role="alert"]')?.remove();
  if (event.target.id === 'source-select') { state.source = event.target.value; render('filter'); }
  else if (event.target.id === 'metric-select') { state.metric = event.target.value; writeNavigation(true); render('filter'); }
  else if (event.target.id === 'entry-kind') changeEntryKind(event.target.value, true);
  else if (event.target.id === 'trend-position') {
    const index = Number(event.target.value);
    if (Number.isInteger(index) && state.series?.[index]) selectDay('trends', state.series[index].at);
  } else {
    const scope = { 'trend-date': 'trends', 'sleep-date': 'sleep', 'review-date': 'review', 'activity-date': 'activity' }[event.target.id];
    if (scope) selectPeriodDate(event.target.value);
  }
});

function changeEntryKind(kind, fromSelect = false) {
  const picker = root.querySelector('#entry-kind');
  if (!picker || !entryKinds.includes(kind)) return;
  if (!fromSelect && picker.value === kind) return;
  picker.value = kind;
  root.querySelector('#entry-value').value = '';
  picker.closest('form')?.querySelector('[role="alert"]')?.remove();
  updateEntryGrade(true); captureEntryDraft();
}

function updateEntryGrade(animate = false) {
  const preview = root.querySelector('#entry-grade');
  if (!preview) return;
  const kind = root.querySelector('#entry-kind').value;
  const input = root.querySelector('#entry-value');
  const optionValue = document.activeElement?.closest('#entry-options [data-value]')?.dataset.value;
  const fields = { mood: ['心情 / 1–5 分', 'numeric', '选择表情，或输入 1–5'], water: ['饮水量 / ml', 'decimal', '填写本次饮水记录量'], caffeine: ['咖啡因 / mg', 'decimal', '填写本次咖啡因记录量，支持 0'], note: ['记录内容', 'text', '记下此刻的感受或发生的小事'] };
  const [label, inputMode, placeholder] = fields[kind] || fields.mood;
  input.inputMode = inputMode; input.placeholder = placeholder; input.setAttribute('aria-label', label);
  const caption = root.querySelector('#entry-value-label');
  if (caption) caption.textContent = label;
  const nextGrade = renderEntryGrade(kind, input.value);
  const gradeChanged = entryGrades.get(preview) !== nextGrade;
  preview.innerHTML = nextGrade;
  entryGrades.set(preview, nextGrade);
  if (animate && gradeChanged) playMotion(preview, [{ opacity: .55 }, { opacity: 1 }], 180);
  const options = root.querySelector('#entry-options');
  if (options) {
    options.innerHTML = renderEntryOptions(kind, input.value);
    if (optionValue !== undefined) [...options.querySelectorAll('[data-value]')].find(option => option.dataset.value === optionValue)?.focus({ preventScroll: true });
  }
  for (const button of root.querySelectorAll('[data-action="entry-kind"]')) button.setAttribute('aria-pressed', String(button.dataset.kind === kind));
}
root.addEventListener('input', event => {
  event.target.closest('#journal-form')?.querySelector('[role="alert"]')?.remove();
  if (event.target.id === 'entry-value') updateEntryGrade(true);
  if (event.target.closest('#journal-form')) captureEntryDraft();
  if (event.target.id === 'trend-position') {
    const index = Number(event.target.value);
    if (Number.isInteger(index) && state.series?.[index]) event.target.setAttribute('aria-valuetext', state.series[index].day);
  }
});

root.addEventListener('submit', async event => {
  if (event.target.id !== 'journal-form') return;
  event.preventDefault();
  if (busy) return;
  try {
    const entry = journalEntry(Object.fromEntries(new FormData(event.target)));
    const editingId = state.editingId;
    const original = editingId ? state.journal.find(item => item.id === editingId) : null;
    if (editingId && !original) throw new Error('原记录已不存在，本次更正未保存。请返回记录列表，重新选择或新增记录。');
    if (editingId) {
      entry.id = editingId;
      // 表单按分钟显示，未更改时间时保留原记录的秒与毫秒。
      if (entry.at === Math.floor(original.at / 60000) * 60000) entry.at = original.at;
    }
    const journal = editingId ? state.journal.map(item => item.id === editingId ? entry : item) : [...state.journal, entry];
    if (journal.length > 10000) throw new Error('最多保存 10,000 条日志，请先备份。');
    captureEntryDraft();
    busy = true; journalSaving = true;
    setFormBusy(event.target, true);
    if (state.mode === 'real') {
      if (!db || !state.storageReady) throw new Error('本地存储不可用，记录未保存。');
      if (editingId && !(await loadData(db)).journal.some(item => item.id === editingId)) throw new Error('原记录已在本机删除，本次更正未保存。请返回记录列表后重新查看。');
      await putJournalEntry(db, entry, { mustExist: !!state.editingId }); real = await loadData(db); showReal();
    } else state.journal = journal;
    state.entryDraft = null; state.editingId = null;
    if (event.target.isConnected) { state.view = 'journal'; navigationTrail = []; state.backView = null; writeNavigation(true); }
    notify(state.mode === 'demo' ? `演示记录已${editingId ? '更正' : '添加'}，退出演示后会丢弃。` : editingId ? '记录已更正，保留原记录编号。' : '生活记录已保存到本机。', 'success');
    document.querySelector('main')?.focus({ preventScroll: true });
  } catch (error) {
    // 保留表单输入，让用户直接修正。
    if (!event.target.isConnected) { notify(`记录未保存：${error.message}`, 'error'); return; }
    let feedback = event.target.querySelector('[role="alert"]');
    if (!feedback) {
      feedback = document.createElement('p'); feedback.setAttribute('role', 'alert');
      feedback.className = 'form-feedback is-new'; feedback.tabIndex = -1;
      event.target.append(feedback);
    }
    feedback.textContent = error.message;
    feedback.focus();
  } finally {
    busy = false; journalSaving = false; setFormBusy(event.target, false);
    const currentForm = root.querySelector('#journal-form');
    if (currentForm && currentForm !== event.target) setFormBusy(currentForm, false);
  }
});

fileInput.addEventListener('change', () => { const file = fileInput.files[0]; fileInput.value = ''; importFile(file); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopUiMotion();
  if (document.hidden && state.breathing.running) { stopBreathing(); notify('页面已离开，呼吸练习已停止。需要时重新开始。'); }
  if (!document.hidden) { refreshVisibleData(); if (nativeRequest) void syncNative(); }
});
function refreshVisibleData() {
  if (!document.hidden && ['overview', 'trends', 'sleep', 'journal', 'recovery', 'activity', 'review'].includes(state.view)
    && !worker && !busy && document.activeElement?.tagName !== 'SELECT') render();
}
setInterval(refreshVisibleData, 60000);

window.addEventListener('popstate', restoreNavigation);
window.addEventListener('zhixi-health-change', () => { if (!document.hidden) void syncNative(); });
writeNavigation(true);
render();
try {
  db = await openDatabase(); real = await loadData(db); state.storageReady = true;
  if (state.mode === 'real') showReal();
  render();
} catch (error) { state.storageError = `本地存储不可用：${error.message}。${state.native ? '日常记录尚未保存，请重新打开知息并检查 iPhone 可用存储。健康读取仍可使用。' : '导入不会自动保存，请退出无痕模式或检查浏览器存储权限。'}`; render(); }
if (nativeRequest) { fileInput.accept = '.json'; void syncNative(); }
if (!nativeRequest && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    state.notice = '离线缓存暂不可用，当前在线功能仍可使用。'; state.noticeTone = 'error'; state.noticeEnter = true;
    if (state.view === 'data') render();
  });
}
