// PDF bytes stay in the browser. Only an explicitly consented rendered page enters AI tracing.
import * as pdfjs from './vendor/pdfjs/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
const asset = name => new URL('./vendor/pdfjs/' + name + '/', import.meta.url).href;
export async function openLocalPDF(file) {
  if (!file || file.size > 16 * 1024 * 1024) throw Error('Choose a PDF smaller than 16 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0,5)) !== '%PDF-') throw Error('This file is not a readable PDF. Export its pages as PNG images instead.');
  let doc, loadingTask, activeRender;
  try { loadingTask = pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, useSystemFonts: false, disableAutoFetch: true, disableStream: true, cMapUrl: asset('cmaps'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts'), wasmUrl: asset('wasm') }); doc=await loadingTask.promise; }
  catch (e) { if(loadingTask)void loadingTask.destroy(); throw Error(e?.name === 'PasswordException' ? 'This PDF is password protected. Upload an unlocked copy or page image.' : 'The PDF could not be decoded. Export the selected page as a PNG image.'); }
  if (doc.numPages > 50) { await loadingTask.destroy(); throw Error('This PDF has more than 50 pages. Save the needed pages in a smaller PDF.'); }
  return {
    pageCount: doc.numPages,
    async render(pageNumber) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) throw Error('Select a valid PDF page.');
      try {
        if(activeRender)activeRender.cancel();const page = await doc.getPage(pageNumber);
        // Fixed 144 dpi source frame; user must calibrate this rendered page independently.
        const viewport = page.getViewport({ scale: 2 });
        if (viewport.width > 8192 || viewport.height > 8192 || viewport.width * viewport.height > 40000000) throw Error('This page is too large to render safely. Export a smaller page crop as PNG.');
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const renderTask=page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' });activeRender=renderTask;await renderTask.promise;if(activeRender===renderTask)activeRender=null;
        const dataURL = canvas.toDataURL('image/png');
        if (dataURL.length > 10 * 1024 * 1024) throw Error('The rendered page is too large. Export a smaller page crop as PNG.');
        return { dataURL, width: canvas.width, height: canvas.height, pageRotation: page.rotate || 0, renderScale: 2 };
      } catch (e) { throw Error(e?.message || 'The page could not be rendered. Export it as a PNG image.'); }
    },
    destroy() { if(activeRender)activeRender.cancel(); return loadingTask.destroy(); }
  };
}
