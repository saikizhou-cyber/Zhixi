import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calendarPeriod } from '../core.mjs';

const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
function functionSource(name) {
  const found = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'));
  assert.ok(found, `生产函数 ${name} 必须存在`);
  return found[0];
}

function element(top = 20, height = 40, left = 0) {
  const node = {
    dataset: {}, rect: { top, bottom: top + height, height, left }, calls: [], isConnected: true,
    getBoundingClientRect() { return this.rect; },
    animate(frames, options) {
      let finish, fail;
      const animation = { cancelCount: 0,
        finished: new Promise((resolve, reject) => { finish = resolve; fail = reject; }),
        cancel() { this.cancelCount++; fail(new Error('cancelled')); }, finish() { finish(); },
      };
      this.calls.push({ frames, options, animation });
      return animation;
    },
  };
  return node;
}

function harness() {
  const main = element(0, 600), marker = element(600, 4, 20), selectors = new Map([
    ['main', main], ['.app-shell', { dataset: { view: 'overview' } }], ['.nav-marker', marker],
  ]), collections = new Map(), raf = [], preferenceListeners = new Map();
  main.scrollTo = function (value) { this.scroll = value; };
  main.focus = () => {};
  const root = { querySelector: selector => selectors.get(selector) || null, querySelectorAll: selector => collections.get(selector) || [] };
  const context = vm.createContext({
    root, state: { view: 'overview' }, activeMotion: new Map(), motionEase: 'cubic-bezier(0.16, 1, 0.3, 1)',
    motionPreference: { matches: false, addEventListener: (type, handler) => preferenceListeners.set(type, handler) },
    document: { hidden: false, activeElement: null, getElementById: () => null },
    requestAnimationFrame: callback => { raf.push(callback); return raf.length; },
  });
  vm.runInContext(['stopUiMotion', 'playMotion', 'visibleMotionElements', 'captureUiMotion', 'animateUiRender', 'animateDisclosure', 'setFormBusy'].map(functionSource).join('\n'), context);
  vm.runInContext(source.match(/^motionPreference\.addEventListener\('change', stopUiMotion\);/m)[0], context);
  return { context, root, main, marker, selectors, collections, raf, preferenceListeners,
    flushFrames() { for (const callback of raf.splice(0)) callback(); } };
}

test('缺少动画 API、减少动态效果或后台页面时跳过播放', () => {
  const { context: c } = harness(), node = element();
  c.playMotion(null, []); c.playMotion({}, []);
  c.motionPreference.matches = true; c.playMotion(node, []);
  c.motionPreference.matches = false; c.document.hidden = true; c.playMotion(node, []);
  assert.equal(node.calls.length, 0); assert.equal(c.activeMotion.size, 0);
  c.document.hidden = false; c.playMotion(node, [{ opacity: 0 }, { opacity: 1 }], 180, 25);
  assert.equal(node.calls.length, 1); assert.equal(node.calls[0].options.duration, 180);
  assert.equal(node.calls[0].options.delay, 25); assert.equal(node.calls[0].options.fill, 'backwards');
  assert.equal(node.calls[0].animation.id, 'zhixi-feedback');
});

test('同一元素的新动效取消旧动效，旧完成回调不能移除新动效', async () => {
  const { context: c } = harness(), node = element();
  c.playMotion(node, [{ opacity: .5 }, { opacity: 1 }]);
  const first = node.calls[0].animation;
  c.playMotion(node, [{ opacity: .7 }, { opacity: 1 }]);
  const second = node.calls[1].animation;
  assert.equal(first.cancelCount, 1); assert.equal(c.activeMotion.get(node), second);
  await Promise.resolve();
  assert.equal(c.activeMotion.get(node), second, '旧 promise 的 rejection 清理不能删除最新动画');
  second.finish(); await Promise.resolve(); assert.equal(c.activeMotion.size, 0);
});

test('停止与切换减少动态效果会取消全部动效并释放引用', async () => {
  const { context: c, preferenceListeners } = harness(), first = element(), second = element();
  c.playMotion(first, []); c.playMotion(second, []);
  c.motionPreference.matches = true; preferenceListeners.get('change')();
  assert.equal(first.calls[0].animation.cancelCount, 1); assert.equal(second.calls[0].animation.cancelCount, 1);
  assert.equal(c.activeMotion.size, 0);
  await Promise.resolve(); assert.equal(c.activeMotion.size, 0);
  c.stopUiMotion(); assert.equal(first.calls[0].animation.cancelCount, 1, '重复停止不会再取消已释放动画');
});

test('只对主内容视口内最多六项采集动效，不处理屏外或零高度元素', () => {
  const { context: c } = harness();
  const shown = Array.from({ length: 8 }, (_, index) => element(index * 50));
  const above = element(-60, 40), below = element(600), empty = element(20, 0);
  const visible = c.visibleMotionElements([above, empty, ...shown, below]);
  assert.equal(visible.length, 6); assert.equal(visible[0], shown[0]); assert.equal(visible[5], shown[5]);
});

test('默认意图不采集快照，不触发布局或入场播放', () => {
  const { context: c, root, main } = harness();
  root.querySelector = () => { throw new Error('none 不应读取布局'); };
  assert.equal(c.captureUiMotion('none'), null);
  c.animateUiRender(null, 'none'); assert.equal(main.calls.length, 0);
  c.motionPreference.matches = true;
  assert.equal(c.captureUiMotion('day'), null); c.animateUiRender({}, 'day');
});

test('跨页只移动主内容与导航标记，返回方向相反且不串入同页卡片动画', () => {
  const h = harness(), c = h.context;
  c.state.view = 'trends';
  c.animateUiRender({ view: 'overview', marker: 0, rows: new Map() }, 'forward');
  assert.equal(h.main.calls[0].frames[0].transform, 'translateX(12px)');
  assert.equal(h.marker.calls[0].frames[0].transform, 'translateX(-20px)');
  c.state.view = 'overview';
  c.animateUiRender({ view: 'trends', marker: 40, rows: new Map() }, 'back');
  assert.equal(h.main.calls[1].frames[0].transform, 'translateX(-12px)');
  assert.equal(h.main.calls[0].animation.cancelCount, 1);
  assert.equal(h.main.calls[1].options.duration, 220);
});

test('同页选日仅反馈可见读数，日志保留项按实际位置移动', () => {
  const h = harness(), c = h.context, focus = element(), grade = element(100), offscreen = element(700);
  c.state.view = 'trends'; h.collections.set('.trend-focus, .trend-panel > .grade-panel', [focus, grade, offscreen]);
  c.animateUiRender({ view: 'trends', marker: 20, rows: new Map() }, 'day');
  assert.equal(h.main.calls.length, 0); assert.equal(focus.calls.length, 1); assert.equal(grade.calls[0].options.delay, 38);
  assert.equal(offscreen.calls.length, 0);
  const retained = element(100); retained.dataset.entryId = 'saved';
  c.state.view = 'journal'; h.collections.set('.journal-today, .journal-entry', [retained]);
  c.animateUiRender({ view: 'journal', marker: 20, rows: new Map([['saved', 140]]) }, 'result');
  assert.equal(retained.calls[0].frames[0].transform, 'translateY(40px)');
});

function disclosure(h) {
  const summary = element(), body = element(80, 80), sibling = element(150);
  const details = { tagName: 'DETAILS', open: false, isConnected: true, children: [summary, body] };
  details.parentElement = { children: [details, sibling] }; summary.parentElement = details;
  return { summary, body, sibling, details };
}

test('details 保留原生开合语义，邻项只轻微移动，关闭反馈摘要而不重播正文', () => {
  const h = harness(), c = h.context, d = disclosure(h);
  c.animateDisclosure(d.summary); assert.equal(d.details.open, false, 'helper 不提前或延后更改原生 open');
  d.details.open = true; Object.assign(d.sibling.rect, { top: 230, bottom: 270 }); h.flushFrames();
  assert.equal(d.body.calls.length, 1); assert.equal(d.sibling.calls[0].frames[0].transform, 'translateY(-8px)');
  assert.equal(d.sibling.calls[0].frames[0].opacity, .65);
  c.animateDisclosure(d.summary); d.details.open = false; Object.assign(d.sibling.rect, { top: 150, bottom: 190 }); h.flushFrames();
  assert.equal(d.body.calls.length, 1, '关闭后不再给隐藏内容播放入场');
  assert.equal(d.sibling.calls[1].frames[0].transform, 'translateY(8px)'); assert.equal(d.sibling.calls[1].options.duration, 150);
  assert.equal(d.sibling.calls[0].animation.cancelCount, 1);
  assert.equal(d.summary.calls.length, 1); assert.equal(d.summary.calls[0].options.duration, 140);
  assert.equal(d.summary.calls[0].frames[0].opacity, .65); assert.equal(d.summary.calls[0].frames[1].opacity, 1);
});

test('details 收起后新进入视口的邻项获得反馈，仅播放变更后可见的前六项', () => {
  const h = harness(), c = h.context, d = disclosure(h);
  d.details.open = true;
  const newlyVisible = Array.from({ length: 8 }, (_, index) => element(1200 + index * 50));
  const leavesViewport = element(50), staysOutside = element(1800);
  d.details.parentElement.children = [d.details, leavesViewport, ...newlyVisible, staysOutside];
  c.animateDisclosure(d.summary);
  d.details.open = false;
  Object.assign(leavesViewport.rect, { top: -80, bottom: -40 });
  newlyVisible.forEach((node, index) => Object.assign(node.rect, { top: 100 + index * 50, bottom: 140 + index * 50 }));
  Object.assign(staysOutside.rect, { top: 900, bottom: 940 });
  h.flushFrames();
  assert.equal(leavesViewport.calls.length, 0, '原来可见但现在屏外的项不播放');
  assert.equal(staysOutside.calls.length, 0);
  newlyVisible.forEach((node, index) => {
    assert.equal(node.calls.length, index < 6 ? 1 : 0);
    if (index < 6) {
      assert.equal(node.calls[0].frames[0].transform, 'translateY(8px)', '超过一屏的距离也只移动 8px');
      assert.equal(node.calls[0].frames[0].opacity, .65);
    }
  });
});

test('details 邻项位移双向限制在 8px，短距离保持原幅度，静止项不播放', () => {
  for (const delta of [-10000, -9, -4, 0, 4, 9, 10000]) {
    const h = harness(), c = h.context, d = disclosure(h);
    Object.assign(d.sibling.rect, { top: 200 + delta, bottom: 240 + delta });
    c.animateDisclosure(d.summary);
    d.details.open = true; Object.assign(d.sibling.rect, { top: 200, bottom: 240 }); h.flushFrames();
    assert.equal(d.sibling.calls.length, delta ? 1 : 0, `delta=${delta}`);
    if (delta) assert.equal(d.sibling.calls[0].frames[0].transform, `translateY(${Math.sign(delta) * Math.min(8, Math.abs(delta))}px)`);
  }
});

test('details 快速复原、脱离页面及切换后台时不会播放过期帧', () => {
  for (const scenario of ['unchanged', 'detached', 'hidden', 'reduce']) {
    const h = harness(), c = h.context, d = disclosure(h);
    c.animateDisclosure(d.summary);
    if (scenario !== 'unchanged') { d.details.open = true; d.sibling.rect.top = 230; }
    if (scenario === 'detached') d.details.isConnected = false;
    if (scenario === 'hidden') c.document.hidden = true;
    if (scenario === 'reduce') c.motionPreference.matches = true;
    h.flushFrames(); assert.equal(d.body.calls.length, 0, scenario); assert.equal(d.sibling.calls.length, 0, scenario);
  }
  const h = harness(); h.context.motionPreference.matches = true;
  h.context.animateDisclosure(disclosure(h).summary); assert.equal(h.raf.length, 0);
});

function form() {
  const submit = { disabled: false, children: [{ className: 'submit-label', textContent: '保存记录' }, { tagName: 'svg', textContent: '' }], dataset: {}, attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    querySelector(selector) { return this.children.find(child => selector === '.submit-label' ? child.className === 'submit-label' : selector === 'svg' && child.tagName === 'svg') || null; },
    get textContent() { return this.children.map(child => child.textContent).join(''); },
    set textContent(value) { this.children = [{ textContent: String(value) }]; },
  };
  return { elements: [{ disabled: false }, submit], attrs: {}, setAttribute(key, value) { this.attrs[key] = value; },
    querySelector: selector => selector === '[type="submit"]' ? submit : null };
}

test('真实 render 默认静默并取消旧动画，保存中重建的新表单仍锁定', () => {
  const h = harness(), c = h.context;
  c.state = { view: 'entry', mode: 'real', period: 'day', periodAnchor: null, records: [], journal: [], source: 'auto', entryDraft: null, breathing: { running: false } };
  h.selectors.get('.app-shell').dataset.view = 'entry';
  Object.assign(c, {
    bandsCache: {}, analysisCache: {}, sourcesRecords: null, renderedMode: 'real', dayFields: {}, busy: true, journalSaving: true,
    personalBands: () => ({}), analyze: () => ({}), daySeries: () => [], calendarPeriod,
    captureEntryDraft() {}, updateEntryGrade() {}, revealSelectedDays() {}, renderApp: () => '<form>重建</form>',
  });
  let writes = 0;
  Object.defineProperty(h.root, 'innerHTML', { set() { writes++; h.selectors.set('#journal-form', form()); } });
  vm.runInContext(functionSource('render'), c);
  c.playMotion(h.main, []); const previous = h.main.calls[0].animation;
  c.render();
  assert.equal(writes, 1); assert.equal(previous.cancelCount, 1); assert.equal(c.activeMotion.size, 0);
  assert.equal(h.main.calls.length, 1, '静默 render 不能新增入场动画');
  const savingForm = h.selectors.get('#journal-form');
  assert.equal(savingForm.attrs['aria-busy'], 'true'); assert.ok(savingForm.elements.every(field => field.disabled));
  assert.equal(savingForm.querySelector('[type="submit"]').textContent, '正在保存…');
  assert.ok(savingForm.querySelector('[type="submit"]').querySelector('svg'));
  c.journalSaving = false; c.render();
  assert.equal(c.busy, true, '保留导入导出的一般忙态以验证不误锁');
  assert.ok(h.selectors.get('#journal-form').elements.every(field => !field.disabled), '一般 busy 不锁录入表单');
  assert.equal(h.selectors.get('#journal-form').querySelector('[type="submit"]').textContent, '保存记录');
  c.busy = false; c.render();
  assert.equal(h.main.calls.length, 1); assert.ok(h.selectors.get('#journal-form').elements.every(field => !field.disabled));
});
