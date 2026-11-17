import { loadData, saveData, importData, putJournalEntry, deleteJournalEntry } from '../storage.mjs';
import { recordKey } from '../core.mjs';

const results = document.querySelector('#results');
const summary = document.querySelector('#summary');
const now = Date.now();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}\n实际：${JSON.stringify(actual)}\n预期：${JSON.stringify(expected)}`);
}

async function rejects(run, name) {
  let error;
  try { await run(); } catch (caught) { error = caught; }
  assert(error instanceof Error, '失败必须拒绝 Error 对象，不能成功或拒绝 null');
  if (name) equal(error.name, name, '错误类型不符');
  return error;
}

function record(value, at = now - value * 1000) {
  const result = { type: 'hrv', value, start: at, end: at, unit: 'ms', source: 'Storage test' };
  return { id: recordKey(result), ...result };
}

function journal(id, value = '测试记录') {
  return { id, kind: 'note', value, note: '', at: now };
}

function openTestDatabase(name) {
  assert(name.startsWith('zhixi-test-'), '禁止访问非测试数据库');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      for (const store of ['records', 'journal', 'meta']) request.result.createObjectStore(store, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('测试数据库创建失败'));
  });
}

async function withDatabase(run) {
  const name = `zhixi-test-${crypto.randomUUID()}`;
  const db = await openTestDatabase(name);
  try { await run(db, name); }
  finally {
    db.close();
    await new Promise((resolve, reject) => {
      assert(name.startsWith('zhixi-test-'), '禁止删除非测试数据库');
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error('测试数据库清理失败'));
      request.onblocked = () => reject(new Error('测试数据库仍有连接未关闭'));
    });
  }
}

const original = () => ({ records: [record(50)], journal: [journal('original')], lastImport: 123 });
const tests = [
  ['初始化为空；显式保存与读取保留三种数据', async db => {
    equal(await loadData(db), { records: [], journal: [], lastImport: null }, '新库不是空数据');
    const data = original();
    await saveData(db, data);
    equal(await loadData(db), data, '存储往返不一致');
  }],
  ['两个独立连接并发导入均保留，返回新增条数与导入时间', async (db, name) => {
    const other = await openTestDatabase(name);
    try {
      const reports = await Promise.all([
        importData(db, { records: [record(40)], journal: [journal('a')] }),
        importData(other, { records: [record(60)], journal: [journal('b')] }),
      ]);
      const loaded = await loadData(db);
      equal(loaded.records.map(entry => entry.value).sort(), [40, 60], '并发导入丢失健康记录');
      equal(loaded.journal.map(entry => entry.id).sort(), ['a', 'b'], '并发导入丢失日志');
      assert(reports.every(report => report.added === 1 && Number.isFinite(report.lastImport)), '返回统计错误');
      const repeated = await importData(db, { records: [record(40)], journal: [] });
      equal(repeated.added, 0, '再次导入未去重');
      equal(repeated.records.length, 2, '重复导入改变记录数量');
    } finally { other.close(); }
  }],
  ['导入超过应用日志容量后回滚，原始健康记录、日志和时间均保留', async db => {
    const data = original();
    await saveData(db, data);
    const excessive = Array.from({ length: 10001 }, (_, index) => journal(`limit-${index}`));
    const error = await rejects(() => importData(db, { records: [record(60)], journal: excessive }));
    assert(error.message.includes('10,000'), '没有命中应用容量限制');
    equal(await loadData(db), data, '失败导入损坏原始数据');
  }],
  ['首次批次 put 的 DataCloneError 回滚，clear 不会清掉原数据', async db => {
    const data = original();
    await saveData(db, data);
    await rejects(() => saveData(db, { records: [record(70), { ...record(80), invalid: () => {} }], journal: [], lastImport: 999 }), 'DataCloneError');
    equal(await loadData(db), data, '同步克隆错误没有完整回滚');
  }],
  ['后续批次回调中的 DataCloneError 也完整回滚', async db => {
    const data = original();
    await saveData(db, data);
    const records = Array.from({ length: 501 }, (_, index) => record(20 + index));
    records[500].invalid = () => {};
    await rejects(() => saveData(db, { records, journal: [], lastImport: 999 }), 'DataCloneError');
    equal(await loadData(db), data, '后续批次错误没有完整回滚');
  }],
  ['导入同事务合并后遇到克隆错误，不提交半份结果', async db => {
    const data = original();
    await saveData(db, data);
    await rejects(() => importData(db, { records: [{ ...record(80), invalid: () => {} }], journal: [journal('new')] }), 'DataCloneError');
    equal(await loadData(db), data, '导入写入错误没有回滚');
  }],
  ['单条日志缺失键时 DataError 拒绝，既有日志不变', async db => {
    const data = original();
    await saveData(db, data);
    await rejects(() => putJournalEntry(db, { kind: 'note', value: 'missing id', at: now }), 'DataError');
    equal(await loadData(db), data, '无效日志导致原始记录变化');
  }],
  ['更正必须保留既有 id，数量不增加且其他记录不变；写入失败回滚', async db => {
    const data = original();
    data.journal.push(journal('untouched', '保持原样'));
    await saveData(db, data);
    const edited = { ...data.journal[0], value: '已更正的内容', note: '更新备注' };
    equal(await putJournalEntry(db, edited, { mustExist: true }), edited, '更正返回值不一致');
    const expected = { ...data, journal: [edited, data.journal[1]] };
    equal(await loadData(db), expected, '更正增加了数量或修改了其他条目、健康数据、导入时间');
    await rejects(() => putJournalEntry(db, { ...edited, invalid: () => {} }, { mustExist: true }), 'DataCloneError');
    equal(await loadData(db), expected, '更正克隆失败后没有回滚');
  }],
  ['更正缺失 id 被拒绝，不能以编辑名义创建记录', async db => {
    const data = original();
    await saveData(db, data);
    const error = await rejects(() => putJournalEntry(db, journal('missing', '不应出现'), { mustExist: true }));
    assert(error.message.includes('已被删除') && error.message.includes('修改未保存'), '缺失记录错误未说明恢复方式');
    equal(await loadData(db), data, '失败更正重建了记录或改动原始数据');
  }],
  ['另一连接先删除后排队的更正不能重新创建，存在检查与写入同事务', async (db, name) => {
    const data = original();
    data.journal.push(journal('untouched', '其他条目'));
    await saveData(db, data);
    const staleEntry = (await loadData(db)).journal.find(entry => entry.id === 'original');
    const other = await openTestDatabase(name);
    try {
      const deletion = deleteJournalEntry(other, staleEntry.id);
      const denied = rejects(() => putJournalEntry(db, { ...staleEntry, value: '过期编辑' }, { mustExist: true }));
      const [, error] = await Promise.all([deletion, denied]);
      assert(error.message.includes('已被删除'), '并发删除没有阻止过期编辑');
      equal(await loadData(db), { ...data, journal: [data.journal[1]] }, '并发更正重建已删除记录或波及其他数据');
    } finally { other.close(); }
  }],
  ['独立连接并发新增日志不覆盖；只删除选定的一条', async (db, name) => {
    const data = original();
    await saveData(db, data);
    const other = await openTestDatabase(name);
    try {
      await Promise.all([putJournalEntry(db, journal('a')), putJournalEntry(other, journal('b'))]);
      equal((await loadData(db)).journal.map(entry => entry.id).sort(), ['a', 'b', 'original'], '并发新增覆盖日志');
      await deleteJournalEntry(db, 'a');
      const loaded = await loadData(db);
      equal(loaded.journal.map(entry => entry.id).sort(), ['b', 'original'], '删除波及其他日志');
      equal(loaded.records, data.records, '日志操作修改了健康数据');
      equal(loaded.lastImport, data.lastImport, '日志操作修改了导入时间');
    } finally { other.close(); }
  }],
  ['单条新增也在事务内限制日志容量，不超限且不丢旧记录', async db => {
    const entries = Array.from({ length: 10000 }, (_, index) => journal(`entry-${index}`));
    await saveData(db, { records: [], journal: entries, lastImport: null });
    await rejects(() => putJournalEntry(db, journal('overflow')));
    const loaded = await loadData(db);
    equal(loaded.journal.length, 10000, '超限新增改变旧日志数量');
    assert(!loaded.journal.some(entry => entry.id === 'overflow'), '超限日志未回滚');
    await putJournalEntry(db, journal('entry-0', '允许更新既有日志'));
    equal((await loadData(db)).journal.find(entry => entry.id === 'entry-0').value, '允许更新既有日志', '容量满时无法更新既有日志');
  }],
  ['用户明确的全部清除仍可原子移除所有数据', async db => {
    await saveData(db, original());
    const empty = { records: [], journal: [], lastImport: null };
    await saveData(db, empty);
    equal(await loadData(db), empty, '显式清除不完整');
  }],
];

let passed = 0;
for (const [name, run] of tests) {
  const item = document.createElement('li');
  item.textContent = `RUN · ${name}`;
  results.append(item);
  try {
    await withDatabase(run);
    passed++;
    item.dataset.status = 'pass';
    item.textContent = `PASS · ${name}`;
  } catch (error) {
    item.dataset.status = 'fail';
    item.textContent = `FAIL · ${name}\n${error?.stack || error}`;
  }
  summary.textContent = `${passed} / ${results.children.length} 项通过，正在运行…`;
}
summary.textContent = `${passed === tests.length ? 'PASS' : 'FAIL'} · ${passed} / ${tests.length} 项通过`;
summary.dataset.status = passed === tests.length ? 'pass' : 'fail';
document.title = `${summary.textContent} · 知息存储测试`;
