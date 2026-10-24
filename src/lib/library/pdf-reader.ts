import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { watchSelection, watchSwipe } from './interaction';
import { markSavedTerms } from './marks';
import type { ReaderOptions, ReaderRenderer } from './types';

/** Flipping the pages of a PDF, drawn as the book itself with selectable text. */
export async function mountPdfReader(
  options: ReaderOptions,
  bytes: Uint8Array
): Promise<ReaderRenderer> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const { container } = options;
  const documentTask = pdfjs.getDocument({ data: bytes });
  const pdf = await documentTask.promise;
  const saved = /^page:(\d+)$/u.exec(options.location ?? '');
  let pageNumber = saved
    ? Math.min(Math.max(Number(saved[1]), 1), pdf.numPages)
    : 1;
  let terms = options.savedTerms;
  let drawing = 0;
  const doc = container.ownerDocument;
  const holder = doc.createElement('div');
  holder.className = 'pdf-holder';
  container.replaceChildren(holder);
  let textLayer: HTMLElement | null = null;
  let shown = pageNumber;

  const draw = async () => {
    const token = (drawing += 1);
    const page = await pdf.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(
      Math.max(container.clientWidth - 2, 200) / natural.width,
      3
    );
    const viewport = page.getViewport({ scale });
    const ratio = window.devicePixelRatio || 1;
    const canvas = doc.createElement('canvas');
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    await page.render({
      canvas,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
    }).promise;
    const layer = doc.createElement('div');
    layer.className = 'textLayer';
    const wrapper = doc.createElement('div');
    wrapper.className = 'pdf-page';
    wrapper.style.width = canvas.style.width;
    wrapper.style.height = canvas.style.height;
    wrapper.style.setProperty('--total-scale-factor', String(scale));
    wrapper.style.setProperty('--scale-factor', String(scale));
    wrapper.append(canvas, layer);
    await new pdfjs.TextLayer({
      textContentSource: page.streamTextContent(),
      container: layer,
      viewport
    }).render();
    if (token !== drawing) return;
    holder.replaceChildren(wrapper);
    shown = pageNumber;
    textLayer = layer;
    markSavedTerms(layer, terms);
    container.scrollTop = 0;
    options.onPosition({
      location: `page:${pageNumber}`,
      fraction: pageNumber / pdf.numPages,
      label: `Page ${pageNumber} of ${pdf.numPages}`,
      canPrev: pageNumber > 1,
      canNext: pageNumber < pdf.numPages
    });
  };
  // A page that fails to draw leaves the previous one on screen and in place.
  const show = async () => {
    const token = drawing + 1;
    try {
      await draw();
    } catch (error) {
      if (token !== drawing) return;
      pageNumber = shown;
      options.onError(
        (error as Error).message || 'That page could not be shown.'
      );
    }
  };
  const go = async (to: number) => {
    if (to < 1 || to > pdf.numPages) return;
    pageNumber = to;
    await show();
  };
  // The text layer is replaced on every page; selections are read from the holder.
  const selectionWatch = watchSelection({
    root: holder,
    language: options.language,
    onSelect: options.onSelect,
    onError: options.onError
  });
  const stopSwipe = watchSwipe(container, doc, (direction) =>
    go(direction === 'next' ? pageNumber + 1 : pageNumber - 1)
  );
  await draw();
  return {
    next: () => go(pageNumber + 1),
    prev: () => go(pageNumber - 1),
    lookup: selectionWatch.read,
    markSaved: (next) => {
      terms = next;
      if (textLayer) markSavedTerms(textLayer, terms);
    },
    destroy: () => {
      selectionWatch.stop();
      stopSwipe();
      container.replaceChildren();
      void documentTask.destroy();
    }
  };
}
