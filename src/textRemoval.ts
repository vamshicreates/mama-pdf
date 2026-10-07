import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { TextSource } from './types';

// Text-only removal: no cover rectangles, image removal, or annotation application.
export function removeTextWithEngine(engine: WrappedPdfiumModule, bytes: Uint8Array, sources: TextSource[]): Uint8Array {
  const runtime = engine.pdfium;
  const alloc = (size: number) => runtime.wasmExports.malloc(size);
  const free = (ptr: number) => runtime.wasmExports.free(ptr);
  const data = alloc(bytes.length);
  let doc = 0;
  try {
    for (let i = 0; i < bytes.length; i++) runtime.setValue(data + i, bytes[i], 'i8');
    doc = engine.FPDF_LoadMemDocument(data, bytes.length, '');
    if (!doc) throw new Error('Could not open this PDF for text editing.');
    for (const index of new Set(sources.map(s => s.page))) {
      const page = engine.FPDF_LoadPage(doc, index);
      if (!page) throw new Error('Could not open the text’s page.');
      const regions = sources.filter(s => s.page === index);
      const ptr = alloc(regions.length * 32);
      try {
        regions.forEach((source, i) => source.quad.forEach((n, j) => runtime.setValue(ptr + i * 32 + j * 4, n, 'float')));
        if (!engine.EPDFText_RedactInQuads(page, ptr, regions.length, true, false) || !engine.FPDFPage_GenerateContent(page)) {
          throw new Error('This text could not be replaced safely. Undo this edit and try another text block.');
        }
      } finally { free(ptr); engine.FPDF_ClosePage(page); }
    }
    const writer = engine.PDFiumExt_OpenFileWriter();
    let output = 0;
    try {
      engine.PDFiumExt_SaveAsCopy(doc, writer);
      const size = engine.PDFiumExt_GetFileWriterSize(writer);
      if (!size) throw new Error('The PDF engine returned an empty file.');
      output = alloc(size);
      engine.PDFiumExt_GetFileWriterData(writer, output, size);
      const result = new Uint8Array(size);
      for (let i = 0; i < size; i++) result[i] = runtime.getValue(output + i, 'i8');
      return result;
    } finally { if (output) free(output); engine.PDFiumExt_CloseFileWriter(writer); }
  } finally { if (doc) engine.FPDF_CloseDocument(doc); free(data); }
}
