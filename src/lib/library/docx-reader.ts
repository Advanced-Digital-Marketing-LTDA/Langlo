import { renderAsync } from 'docx-preview';
import { watchSelection, watchSwipe } from './interaction';
import { markSavedTerms } from './marks';
import type { ReaderOptions, ReaderRenderer } from './types';

/** Flipping the pages of a Word document, drawn with its own layout. */
export async function mountDocxReader(
  options: ReaderOptions,
  bytes: Uint8Array
): Promise<ReaderRenderer> {
  const { container } = options;
  const doc = container.ownerDocument;
  const holder = doc.createElement('div');
  holder.className = 'docx-holder';
  container.replaceChildren(holder);
  await renderAsync(bytes, holder, undefined, {
    className: 'docx',
    breakPages: true,
    inWrapper: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: false,
    renderFooters: false,
    renderFootnotes: false,
    renderEndnotes: false,
    useBase64URL: true
  });
  // A document must not be able to link out of the reader.
  for (const link of Array.from(holder.querySelectorAll('a')))
    link.removeAttribute('href');
  const pages = Array.from(
    holder.querySelectorAll<HTMLElement>('section.docx')
  );
  if (!pages.length) throw new Error('The document has no pages');
  const saved = /^page:(\d+)$/u.exec(options.location ?? '');
  let index = saved
    ? Math.min(Math.max(Number(saved[1]) - 1, 0), pages.length - 1)
    : 0;
  let terms = options.savedTerms;

  const show = () => {
    pages.forEach((page, at) => {
      page.style.display = at === index ? '' : 'none';
    });
    const page = pages[index];
    const width = page.offsetWidth;
    const available = container.clientWidth - 2;
    page.style.zoom = width > available ? String(available / width) : '';
    markSavedTerms(page, terms);
    container.scrollTop = 0;
    options.onPosition({
      location: `page:${index + 1}`,
      fraction: (index + 1) / pages.length,
      label: `Page ${index + 1} of ${pages.length}`,
      canPrev: index > 0,
      canNext: index < pages.length - 1
    });
  };
  const go = async (to: number) => {
    if (to < 0 || to >= pages.length) return;
    index = to;
    show();
  };
  const stopSelection = watchSelection({
    root: () => pages[index],
    language: options.language,
    onSelect: options.onSelect,
    onError: options.onError
  });
  const stopSwipe = watchSwipe(container, doc, (direction) =>
    go(direction === 'next' ? index + 1 : index - 1)
  );
  show();
  return {
    next: () => go(index + 1),
    prev: () => go(index - 1),
    markSaved: (next) => {
      terms = next;
      markSavedTerms(pages[index], terms);
    },
    destroy: () => {
      stopSelection();
      stopSwipe();
      container.replaceChildren();
    }
  };
}
