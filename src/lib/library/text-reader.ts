import { paginateText } from '../library-text';
import { watchSelection, watchSwipe } from './interaction';
import { markSavedTerms } from './marks';
import type { ReaderOptions, ReaderRenderer } from './types';

const pageCharacters = 1800;

/** Flipping pages of the extracted text (TXT files). */
export function mountTextReader(
  options: ReaderOptions,
  content: string
): ReaderRenderer {
  const { container } = options;
  const pages = paginateText(content, pageCharacters);
  const saved = /^page:(\d+)$/u.exec(options.location ?? '');
  const last = Math.max(pages.length - 1, 0);
  const startIndex = saved
    ? Number(saved[1]) - 1
    : Math.floor(options.legacyFraction * pages.length);
  let index = Math.min(Math.max(startIndex, 0), last);
  let terms = options.savedTerms;
  const view = container.ownerDocument.createElement('div');
  view.className = 'text-page';
  container.replaceChildren(view);

  const show = () => {
    view.replaceChildren(
      ...pages[index].split('\n').map((paragraph) => {
        const element = view.ownerDocument.createElement('p');
        element.textContent = paragraph;
        return element;
      })
    );
    markSavedTerms(view, terms);
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
    root: view,
    language: options.language,
    onSelect: options.onSelect,
    onError: options.onError
  });
  const stopSwipe = watchSwipe(
    container,
    container.ownerDocument,
    (direction) => go(direction === 'next' ? index + 1 : index - 1)
  );
  show();
  return {
    next: () => go(index + 1),
    prev: () => go(index - 1),
    markSaved: (next) => {
      terms = next;
      markSavedTerms(view, terms);
    },
    destroy: () => {
      stopSelection();
      stopSwipe();
      container.replaceChildren();
    }
  };
}
