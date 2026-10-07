import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.includes('@pdf-lib/fontkit')) return 'pdf-fonts';
    if (id.includes('pdf-lib')) return 'pdf-write';
    if (id.includes('pdfjs-dist')) return 'pdf-render';
  } } } },
  server: { port: 5173 },
});
