import ePub from 'epubjs';
import type Contents from 'epubjs/types/contents';
import { watchSelection, watchSwipe } from './interaction';
import { markSavedTerms } from './marks';
import type { ReaderOptions, ReaderRenderer } from './types';

type EpubRendition = ReturnType<ReturnType<typeof ePub>['renderTo']>;

type EpubLocation = {
  atStart: boolean;
  atEnd: boolean;
  start: {
    cfi: string;
    index: number;
    displayed: { page: number; total: number };
  };
};

/** Where the reader stands, from an epub.js relocation. */
function positionOf(location: EpubLocation, sections: number) {
  const { index, displayed } = location.start;
  const fraction = location.atEnd
    ? 1
    : Math.min(
        (index + (displayed.page - 1) / Math.max(displayed.total, 1)) /
          sections,
        1
      );
  return {
    location: location.start.cfi,
    fraction,
    label: `${Math.round(fraction * 100)}% read`,
    canPrev: !location.atStart,
    canNext: !location.atEnd
  };
}

/** Wire saved-word marks, selection, swiping and arrow keys into one section. */
function attachToSection(
  contents: Contents,
  rendition: EpubRendition,
  options: ReaderOptions,
  terms: string[]
): (() => void)[] {
  const doc = contents.document;
  markSavedTerms(doc.body, terms);
  doc.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowRight') void rendition.next();
    if (event.key === 'ArrowLeft') void rendition.prev();
  });
  return [
    watchSelection({
      root: doc.body,
      language: options.language,
      frame: (doc.defaultView?.frameElement as HTMLElement | null) ?? undefined,
      onSelect: options.onSelect,
      onError: options.onError
    }),
    watchSwipe(
      doc,
      doc,
      (direction) =>
        void (direction === 'next' ? rendition.next() : rendition.prev())
    )
  ];
}

/** Flipping the pages of an EPUB in its own layout, inside a sandboxed frame. */
export async function mountEpubReader(
  options: ReaderOptions,
  bytes: Uint8Array
): Promise<ReaderRenderer> {
  const { container } = options;
  const holder = container.ownerDocument.createElement('div');
  holder.className = 'epub-holder';
  container.replaceChildren(holder);
  const book = ePub(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  );
  const rendition = book.renderTo(holder, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: 'none',
    allowScriptedContent: false
  });
  let terms = options.savedTerms;
  const stops: (() => void)[] = [];

  rendition.hooks.content.register((contents: Contents) => {
    stops.push(...attachToSection(contents, rendition, options, terms));
  });
  rendition.on('relocated', (location: EpubLocation) => {
    const sections = Math.max(
      (book.spine as unknown as { length: number }).length,
      1
    );
    options.onPosition(positionOf(location, sections));
  });

  await rendition.display(
    options.location?.startsWith('epubcfi(') ? options.location : undefined
  );
  return {
    next: async () => {
      await rendition.next();
    },
    prev: async () => {
      await rendition.prev();
    },
    markSaved: (next) => {
      terms = next;
      for (const contents of rendition.getContents() as unknown as Contents[])
        markSavedTerms(contents.document.body, terms);
    },
    destroy: () => {
      for (const stop of stops) stop();
      rendition.destroy();
      book.destroy();
      container.replaceChildren();
    }
  };
}
