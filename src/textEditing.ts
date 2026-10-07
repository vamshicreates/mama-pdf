import type { EditorState, TextSource } from './types';
let worker: Worker | undefined;
let nextId = 0;
const requests = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>();
const cache = new WeakMap<Uint8Array, Map<string, Promise<Uint8Array>>>();
export function textSources(state: EditorState): TextSource[] {
  return state.marks.filter(m => state.pages.some(p => p.id === m.pageId)).flatMap(m => m.replaces ? [m.replaces] : []).sort((a,b) => a.id.localeCompare(b.id));
}
export function removeOriginalText(bytes: Uint8Array, sources: TextSource[]): Promise<Uint8Array> {
  if (!sources.length) return Promise.resolve(bytes);
  const key = JSON.stringify(sources);
  let entries = cache.get(bytes);
  if (!entries) { entries = new Map(); cache.set(bytes, entries); }
  const existing = entries.get(key);
  if (existing) return existing;
  if (!worker) {
    worker = new Worker(new URL('./textRemoval.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const pending = requests.get(data.id); requests.delete(data.id);
      if (data.error) pending?.reject(new Error(data.error)); else pending?.resolve(data.bytes);
    };
    worker.onerror = () => {
      for (const pending of requests.values()) pending.reject(new Error('The text editor could not load. Refresh and try again.'));
      requests.clear(); worker?.terminate(); worker = undefined;
    };
  }
  const promise = new Promise<Uint8Array>((resolve, reject) => {
    const id = ++nextId; requests.set(id, { resolve, reject }); worker!.postMessage({ id, bytes, sources });
  }).catch(error => { entries!.delete(key); throw error; });
  if (entries.size >= 3) entries.delete(entries.keys().next().value!);
  entries.set(key, promise);
  return promise;
}
