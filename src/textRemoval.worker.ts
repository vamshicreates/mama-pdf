import { init } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { removeTextWithEngine } from './textRemoval';
import type { TextSource } from './types';
const engine = fetch(wasmUrl).then(async response => {
  if (!response.ok) throw new Error('Could not load the text editor. Refresh and try again.');
  const instance = await init({ wasmBinary: await response.arrayBuffer() });
  instance.PDFiumExt_Init();
  return instance;
});
self.onmessage = async ({ data }: MessageEvent<{ id: number; bytes: Uint8Array; sources: TextSource[] }>) => {
  try {
    const bytes = removeTextWithEngine(await engine, data.bytes, data.sources);
    self.postMessage({ id: data.id, bytes }, { transfer: [bytes.buffer] });
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Text editing failed.' }); }
};
