# Mama PDF

A personal PDF editor with charcoal, coral, and condensed Mama typography. React + TypeScript + Vite. PDF.js renders documents, PDFium removes replaced text, and pdf-lib writes additions while preserving the remaining page content.

## Use it

```sh
npm ci
npm run dev
```

Open the address printed by Vite. Choose a PDF, try the included project brief, or start a blank page. Changes are recovered from one local IndexedDB draft. Download exports a new PDF; the original file stays untouched. Delete the local draft from the home screen.

## Included

- Edit existing PDF text or add new text, with font, size, color, and opacity controls
- PNG/JPEG/WebP placement, move and proportional resize
- Typed and hand-drawn visual signatures
- Area highlights, freehand drawing, rectangles, ellipses, lines, arrows, whiteout
- Clickable URL and email link areas
- Filling existing standard AcroForm text fields, checkboxes, radio buttons and choices
- Page thumbnails, navigation, reorder, rotation, deletion and blank page insertion
- Undo/redo, duplication, keyboard shortcuts and zoom
- Automatic local draft recovery
- Locally bundled fonts, PDF worker, CMaps and rendering resources

## Boundaries

Click existing text with Select or Text to replace a text block. Original text is removed using PDFium in a local worker, and replacement text is written using the selected standard font. The font and color may need adjustment to match the original. Clear the text box to delete the original; Restore original text or Undo restores it. Scanned or outlined text cannot be selected without OCR. Whiteout covers content and is not secure redaction. Existing annotations are preserved but are not editable objects. Signatures are visual marks, not certificate-backed digital signatures. Encrypted PDFs, XFA forms and OCR are not supported. New ordinary text uses PDF standard Latin fonts. Unsupported characters produce an export error instead of being silently discarded. The editor accepts files up to 100 MB, with practical performance dependent on the device. Drafts are tied to this browser and site address; they do not sync between devices.

PDF bytes never go to a server. There is no analytics or upload API. The application itself has no account gate; anyone with its URL can use it with their own local files. Access restrictions can be configured through the owning Vercel project if desired.

## Production

```sh
npm test
npm run build
npm run preview
```

Deploy this directory to Vercel using the included `vercel.json`, or deploy the compiled `dist` folder as a static site. `npm run build` copies PDF.js support assets before compiling.

## Checks

The export suite checks selectable text, form persistence, reordered/deleted/blank pages, rotations of 0/90/180/270 degrees, crop offsets, PDF UserUnit scaling and unsafe-link rejection. The sample document includes standard form fields for browser verification.

Fonts: Barlow Condensed 900/900 italic for the brand and display, Inter for controls, Caveat for typed signatures. Color accent: `#ED655C`.
