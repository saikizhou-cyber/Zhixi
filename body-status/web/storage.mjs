import { mergeData } from './model.mjs';

const NAME = 'zhixi-health';
const STORES = ['records', 'journal', 'meta'];

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      for (const name of STORES) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error || new Error('无法打开本地数据库。'));
    request.onblocked = () => { blocked = true; reject(new Error('请关闭其他知息标签页后重试。')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

// 请求错误先记录原因，等 abort 确认回滚后才拒绝 Promise；事务尚未创建时的异常直接拒绝。
function transaction(db, names, mode, queue) {
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(names, mode); }
    catch (error) { reject(error); return; }
    let result, failure;
    const guard = callback => (...args) => {
      try { callback(...args); }
      catch (error) {
        failure ??= error instanceof Error ? error : new Error(String(error));
        // 同步 DataError / DataCloneError 不会自动撤销已经排队的 clear()。
        try { tx.abort(); } catch { /* 已结束的事务仍由 complete / abort 事件收尾。 */ }
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = event => { failure ??= event.target?.error || tx.error || new Error('本地数据库请求失败。'); };
    tx.onabort = () => reject(failure || tx.error || new Error('操作已中止，原数据未变更。'));
    guard(() => queue(tx, value => { result = value; }, guard))();
  });
}

export function loadData(db) {
  return transaction(db, STORES, 'readonly', (tx, done, guard) => {
    const records = tx.objectStore('records').getAll();
    const journal = tx.objectStore('journal').getAll();
    const meta = tx.objectStore('meta').get('lastImport');
    meta.onsuccess = guard(() => done({ records: records.result, journal: journal.result, lastImport: meta.result?.value ?? null }));
  });
}

function putBatches(store, entries, guard) {
  let cursor = 0;
  function batch() {
    let last;
    for (const end = Math.min(cursor + 500, entries.length); cursor < end; cursor++) last = store.put(entries[cursor]);
    if (cursor < entries.length) last.onsuccess = guard(batch);
  }
  batch();
}

function replaceData(tx, { records, journal, lastImport }, guard) {
  if (!Array.isArray(records) || !Array.isArray(journal)) throw new Error('保存的数据格式不正确。');
  const recordsStore = tx.objectStore('records');
  const journalStore = tx.objectStore('journal');
  recordsStore.clear();
  journalStore.clear();
  tx.objectStore('meta').put({ id: 'lastImport', value: lastImport });
  putBatches(recordsStore, records, guard);
  putBatches(journalStore, journal, guard);
}

// 完整替换只用于明确的全部清除；导入使用下方同事务读取和合并。
export function saveData(db, data) {
  return transaction(db, STORES, 'readwrite', (tx, _done, guard) => replaceData(tx, data, guard));
}

export function importData(db, incoming) {
  return transaction(db, STORES, 'readwrite', (tx, done, guard) => {
    const records = tx.objectStore('records').getAll();
    const journal = tx.objectStore('journal').getAll();
    journal.onsuccess = guard(() => {
      // readwrite 事务跨连接串行执行；第二个标签页读取到前一个已经提交的版本。
      const merged = mergeData({ records: records.result, journal: journal.result }, incoming);
      const next = { records: merged.records, journal: merged.journal, lastImport: Date.now(), added: merged.added };
      replaceData(tx, next, guard);
      done(next);
    });
  });
}

export function putJournalEntry(db, entry, { mustExist = false } = {}) {
  return transaction(db, 'journal', 'readwrite', (tx, done, guard) => {
    const store = tx.objectStore('journal');
    const put = () => {
      store.put(entry);
      const count = store.count();
      count.onsuccess = guard(() => {
        if (count.result > 10000) throw new Error('日志超过 10,000 条，请先导出备份。');
        done(entry);
      });
    };
    if (mustExist) {
      const existing = store.get(entry.id);
      existing.onsuccess = guard(() => {
        if (!existing.result) throw new Error('这条记录已被删除，修改未保存。请返回记录列表查看。');
        put();
      });
    } else put();
  });
}

export function deleteJournalEntry(db, id) {
  return transaction(db, 'journal', 'readwrite', tx => {
    tx.objectStore('journal').delete(id);
  });
}
