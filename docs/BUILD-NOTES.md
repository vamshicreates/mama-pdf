# Mama PDF build notes

Built 7 October 2026. Scope is the PDF editor only.

The editor stores edits in original visible page coordinates and maps them back to PDF coordinates at export, preserving rotation, crop origins and UserUnit scaling. Rotating a page rotates its contents and edits together. Export adds vector shapes and selectable standard-font text; it does not rasterize the original PDF. Typed signatures embed Caveat. Drawn signatures and inserted images use PNG.

Validation: production TypeScript/Vite build; automated PDF round-trip checks; desktop and 390px-wide browser review; sample text, highlighting, forms, typed signature, rotation/undo, download and draft recovery. The downloaded sample was reopened with PDF.js and pdf-lib to inspect added text and field values.

The legacy preview endpoint is retired. The official Vercel CLI 62.7.0 supports anonymous deployment with `vercel deploy --temporary`. The compiled static app was deployed successfully with status READY. Temporary deployments expire after 60 minutes unless claimed. The source and verified production build remain in this project folder.

The user subsequently claimed the deployment into `vamshicreates`. Its dashboard now shows a Ready Production Deployment; see DEPLOYMENT.md.

## Existing text editing update

PDF.js extracts text runs and oriented hit regions. Each replacement retains an immutable source quad in PDF coordinates. A self-hosted PDFium WASM worker removes text in those quads (including nested forms) without black rectangles or image redaction. The cleaned document feeds the page preview and export; overlays remain editable. Undo restores the original source. Duplicates do not inherit source removal. Work stays on-device. Replacement typography uses the selected standard font; scanned/outlined text needs OCR.

This update passed the TypeScript/Vite production build. No new automated tests were added or run for this update.
