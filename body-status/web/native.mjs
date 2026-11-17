import { RECORD_UNITS } from './importer.mjs';

/** 仅包内页面启用消息桥；普通网页永远走文件导入。 */
export function nativeBridge(scope = globalThis) {
  const handler = scope.webkit?.messageHandlers?.zhixiHealth;
  if (scope.location?.protocol !== 'zhixi:' || scope.location?.hostname !== 'app'
    || scope.location?.pathname !== '/index.html' || typeof handler?.postMessage !== 'function') return null;
  return (action, payload = {}) => handler.postMessage({ ...payload, version: 1, action });
}

export const emptyNative = () => ({ available: false, accessRequested: false, isLoading: false,
  lastLoadedAt: null, historyStart: null, message: null, backgroundMessage: null, records: [], error: null });

/** 原生边界也校验单位和时间；损坏快照不应部分进入健康分析。 */
export function healthSnapshot(value, now = Date.now()) {
  const time = v => v === null || (Number.isFinite(v) && v >= 0 && v <= now + 60000);
  const message = v => v === null || (typeof v === 'string' && v.length <= 10000);
  const fail = () => { throw new Error('健康数据格式不匹配，请重新打开 App 后再试。'); };
  if (!value || value.version !== 1 || !['available', 'accessRequested', 'isLoading'].every(k => typeof value[k] === 'boolean')
    || !time(value.lastLoadedAt) || !time(value.historyStart) || !message(value.message) || !message(value.backgroundMessage)
    || !Array.isArray(value.records) || value.records.length > 250000) fail();
  if (value.records.length && (!value.accessRequested || value.lastLoadedAt === null || value.historyStart === null)) fail();
  if (value.historyStart !== null && value.lastLoadedAt !== null && value.historyStart > value.lastLoadedAt) fail();
  const records = value.records.map(r => {
    if (!r || !Object.hasOwn(RECORD_UNITS, r.type) || r.unit !== RECORD_UNITS[r.type]
      || typeof r.source !== 'string' || !r.source.trim() || r.source.length > 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(r.source)
      || !Number.isFinite(r.start) || !Number.isFinite(r.end) || r.start < 0 || r.start > r.end
      || r.end > value.lastLoadedAt || r.end < value.historyStart) fail();
    if (r.type === 'sleep') {
      if (r.start === r.end || !['inBed', 'awake', 'asleep', 'core', 'deep', 'rem'].includes(r.value)) fail();
    } else if (r.type === 'workout') {
      if (r.start === r.end || typeof r.value !== 'string' || !r.value.trim() || r.value.length > 160) fail();
    } else if (!Number.isFinite(r.value) || (['steps', 'activeEnergy'].includes(r.type) ? r.value < 0 : r.value <= 0)
      || (r.type === 'oxygenSaturation' && r.value > 100)) fail();
    return { type: r.type, value: r.value, unit: r.unit, source: r.source, start: r.start, end: r.end };
  });
  return { available: value.available, accessRequested: value.accessRequested, isLoading: value.isLoading,
    lastLoadedAt: value.lastLoadedAt, historyStart: value.historyStart, message: value.message,
    backgroundMessage: value.backgroundMessage, records, error: null };
}
