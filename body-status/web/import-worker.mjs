import { parseHealthFile } from './importer.mjs';

self.onmessage = async ({ data }) => {
  try {
    const result = await parseHealthFile(data.file, { onProgress: progress => self.postMessage({ type: 'progress', ...progress }) });
    self.postMessage({ type: 'done', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : '导入失败，请检查文件' });
  }
};
