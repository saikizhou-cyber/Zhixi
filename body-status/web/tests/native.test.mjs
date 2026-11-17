import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { nativeBridge, healthSnapshot, emptyNative } from '../native.mjs';
import { parseHealthFile, RECORD_UNITS } from '../importer.mjs';

const now = Date.now();
const record = (type = 'hrv', overrides = {}) => ({ type, value: type === 'sleep' ? 'core' : type === 'workout' ? '跑步' : 42,
  source: 'Apple Watch (com.apple.health)', start: now - 60000, end: now - 30000, unit: RECORD_UNITS[type], ...overrides });
const snapshot = (records = [record()]) => ({ version: 1, available: true, accessRequested: true, isLoading: false,
  lastLoadedAt: now, historyStart: now - 90 * 86400000, message: null, backgroundMessage: null, records });

test('消息桥仅允许固定包内页面且保留 handler 的 this；普通网站不能启用原生模式', async () => {
  const messages = [], handler = { postMessage(message) { assert.equal(this, handler); messages.push(message); return Promise.resolve({ ok: true }); } };
  const scope = { location: new URL('zhixi://app/index.html'), webkit: { messageHandlers: { zhixiHealth: handler } } };
  await nativeBridge(scope)('connect');
  assert.deepEqual(messages, [{ version: 1, action: 'connect' }]);
  for (const url of ['https://app/index.html', 'zhixi://other/index.html', 'zhixi://app/other.html', 'file:///index.html']) {
    assert.equal(nativeBridge({ ...scope, location: new URL(url) }), null);
  }
  assert.equal(nativeBridge({ location: scope.location }), null);
});

test('九类原生记录与长来源在现有 JSON 备份中完整往返，剥除桥外字段', async () => {
  const source = '健康来源'.repeat(80) + ' (com.example.device)';
  const records = Object.keys(RECORD_UNITS).map(type => record(type, { source, extra: 'ignored' }));
  const value = healthSnapshot(snapshot(records), now);
  assert.equal(value.records.length, 9);
  assert.ok(value.records.every(r => !('extra' in r)));
  const json = JSON.stringify({ schemaVersion: 1, records: value.records, journal: [] });
  const imported = await parseHealthFile(new File([json], 'native.json'));
  assert.equal(imported.records.length, 9);
  for (const r of imported.records) assert.deepEqual(value.records.find(v => v.type === r.type), Object.fromEntries(Object.entries(r).filter(([key]) => key !== 'id')));
});

test('拒绝错误单位、未来时间、非法阶段、非有限值和无授权请求的记录', () => {
  for (const changes of [{ type: '__proto__' }, { unit: 's' }, { value: NaN }, { end: now + 1 },
    { start: -1 }, { source: '' }, { source: '\u0001' }, { type: 'oxygenSaturation', unit: '%', value: 101 },
    { type: 'sleep', unit: '', value: 'unknown' }, { type: 'workout', unit: '', value: '' }]) {
    assert.throws(() => healthSnapshot(snapshot([record('hrv', changes)]), now));
  }
  for (const changes of [{ version: 2 }, { accessRequested: false }, { lastLoadedAt: null },
    { historyStart: now + 1 }, { message: {} }, { available: 'yes' }, { records: Array(250001) }]) {
    assert.throws(() => healthSnapshot({ ...snapshot(), ...changes }, now));
  }
  assert.equal(healthSnapshot(snapshot([record('steps', { value: 0 })]), now).records[0].value, 0);
});

test('首次、读取中和完成选择但无数据都不推断读取许可', () => {
  const initial = healthSnapshot({ ...emptyNative(), version: 1 }, now);
  assert.equal(initial.accessRequested, false); assert.deepEqual(initial.records, []);
  const denied = healthSnapshot(snapshot([]), now);
  assert.equal(denied.accessRequested, true); assert.ok(!('authorized' in denied));
  assert.equal(healthSnapshot({ ...snapshot([]), lastLoadedAt: null, isLoading: true }, now).isLoading, true);
});

const app = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
const fn = name => app.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'))?.[0] || assert.fail(`missing ${name}`);
function harness(request) {
  const context = vm.createContext({ nativeRequest: request, healthSnapshot, nativePending: false,
    state: { native: emptyNative(), nativeBusy: false, mode: 'real', source: 'auto', entryDraft: { note: '未保存' }, records: [], journal: [] },
    real: { records: [record('steps')], journal: [{ id: 'journal' }], lastImport: 123 },
    render() {}, captures: 0, captureEntryDraft() { context.captures++; },
  });
  vm.runInContext(['showReal', 'syncNative'].map(fn).join('\n'), context);
  return context;
}

test('原生快照替换旧值；撤回/删样本的空快照清除健康视图但不改本机日志', async () => {
  let result = snapshot(); const c = harness(async () => result);
  await c.syncNative(); assert.equal(c.state.records[0].type, 'hrv');
  assert.equal(c.state.journal[0].id, 'journal'); assert.equal(c.state.entryDraft.note, '未保存');
  result = snapshot([]); await c.syncNative(); assert.equal(c.state.records.length, 0);
  assert.equal(c.real.records.length, 1); assert.equal(c.real.journal.length, 1);
  c.state.native = null; c.showReal(); assert.equal(c.state.records[0].type, 'steps', 'Web 仍使用导入分区');
});

test('桥接错误不继续展示旧记录，错误可恢复；演示不会被后台刷新替换', async () => {
  let error = false; const c = harness(async () => { if (error) throw new Error('设备暂时锁定'); return snapshot(); });
  await c.syncNative(); error = true; await c.syncNative('refresh');
  assert.equal(c.state.records.length, 0); assert.match(c.state.native.error, /锁定/); assert.equal(c.state.nativeBusy, false);
  error = false; c.state.mode = 'demo'; c.state.records = [record('steps')]; await c.syncNative();
  assert.equal(c.state.mode, 'demo'); assert.equal(c.state.records[0].type, 'steps'); assert.equal(c.state.native.error, null);
  c.showReal(); assert.equal(c.state.records[0].type, 'hrv');
});

test('并发更新合并为随后一次状态读取，授权请求不重复弹出', async () => {
  let release; const calls = [];
  const c = harness(action => { calls.push(action); return calls.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(snapshot([])); });
  const first = c.syncNative('connect');
  await c.syncNative('connect'); await c.syncNative(); await c.syncNative();
  assert.deepEqual(calls, ['connect']); release(snapshot()); await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['connect', 'status']); assert.equal(c.state.records.length, 0); assert.equal(c.state.nativeBusy, false);
});

test('原生导入在持久化边界只保存日志，不将 HealthKit 或备份健康快照写入数据库', async () => {
  let written;
  const c = harness(async () => snapshot());
  Object.assign(c, { busy: false, db: {}, render() {}, cancelImport() {}, notify() {}, navigator: {},
    importData: async (_db, incoming) => { written = incoming; return { records: [], journal: incoming.journal, lastImport: now, added: 0 }; } });
  c.state.storageReady = true; c.state.importPreview = { records: [record()], journal: [{ id: 'restored' }] };
  vm.runInContext(fn('commitImport'), c); await c.commitImport();
  assert.equal(written.records.length, 0); assert.equal(written.journal[0].id, 'restored');
  assert.equal(c.state.records.length, 0); assert.equal(c.state.journal[0].id, 'restored');
});
