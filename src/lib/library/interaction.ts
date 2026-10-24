import {
  collapseWhitespace,
  locateSelection,
  sentenceContext,
  snapToWords
} from '../library-text';
import type { ReaderSelection } from './types';

const maxTermLength = 256;

/** The word segment around a collapsed caret, selected in place. */
function selectWordAtCaret(doc: Document, language: string): boolean {
  const selection = doc.defaultView?.getSelection();
  const node = selection?.anchorNode;
  if (!selection || node?.nodeType !== 3) return false;
  const caret = selection.anchorOffset;
  const text = (node as Text).data;
  for (const part of new Intl.Segmenter(language, {
    granularity: 'word'
  }).segment(text)) {
    const end = part.index + part.segment.length;
    if (part.isWordLike && caret >= part.index && caret <= end) {
      const range = doc.createRange();
      range.setStart(node, part.index);
      range.setEnd(node, end);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
  }
  return false;
}

/**
 * Report the word or phrase the learner selects inside `root`: a click or a
 * drag with the mouse, or a press-and-hold selection with touch. `frame` is
 * the iframe element when `root` lives in one.
 */
export function watchSelection(options: {
  /** The element holding the page being read; a function when it changes. */
  root: HTMLElement | (() => HTMLElement);
  language: string;
  frame?: HTMLElement;
  onSelect: (selection: ReaderSelection) => void;
  onError: (message: string) => void;
}): () => void {
  const { language, frame } = options;
  const rootOf = () =>
    typeof options.root === 'function' ? options.root() : options.root;
  const doc = rootOf().ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => undefined;
  let pointer = 'mouse';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const read = () => {
    const selection = win.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const root = rootOf();
    if (!root.contains(range.commonAncestorContainer)) return;
    const selected = selection.toString();
    if (!selected.trim()) return;
    const before = doc.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const page = collapseWhitespace(root.innerText);
    const located = locateSelection(
      page,
      selected,
      collapseWhitespace(before.toString()).length
    );
    const snapped = located && snapToWords(page, located.start, located.end);
    if (!snapped) {
      options.onError('Select a word or phrase in the text.');
      return;
    }
    if (snapped.text.length > maxTermLength) {
      options.onError('Select a shorter word or phrase.');
      return;
    }
    const frameBox = frame?.getBoundingClientRect();
    const box = range.getBoundingClientRect();
    options.onSelect({
      term: snapped.text,
      ...sentenceContext(page, snapped.start, snapped.end, language),
      rect: {
        top: box.top + (frameBox?.top ?? 0),
        bottom: box.bottom + (frameBox?.top ?? 0),
        left: box.left + (frameBox?.left ?? 0),
        right: box.right + (frameBox?.left ?? 0)
      }
    });
  };

  const onPointerDown = (event: PointerEvent) => {
    pointer = event.pointerType;
  };
  const onMouseUp = (event: MouseEvent) => {
    if (event.button !== 0 || pointer !== 'mouse') return;
    if (!rootOf().contains(event.target as Node)) return;
    // Wait a tick so the browser has settled the selection after the click.
    setTimeout(() => {
      const selection = win.getSelection();
      if (selection?.isCollapsed && !selectWordAtCaret(doc, language)) return;
      read();
    });
  };
  const onSelectionChange = () => {
    if (pointer === 'mouse') return;
    clearTimeout(timer);
    timer = setTimeout(read, 400);
  };

  doc.addEventListener('pointerdown', onPointerDown);
  doc.addEventListener('mouseup', onMouseUp);
  doc.addEventListener('selectionchange', onSelectionChange);
  return () => {
    clearTimeout(timer);
    doc.removeEventListener('pointerdown', onPointerDown);
    doc.removeEventListener('mouseup', onMouseUp);
    doc.removeEventListener('selectionchange', onSelectionChange);
  };
}

/** Flip pages with a horizontal swipe, unless the learner is selecting text. */
export function watchSwipe(
  target: EventTarget,
  doc: Document,
  flip: (direction: 'next' | 'prev') => void
): () => void {
  let start: { x: number; y: number } | null = null;
  const onStart = (event: Event) => {
    const touch = (event as TouchEvent).touches[0];
    start =
      event.type === 'touchstart'
        ? { x: touch.clientX, y: touch.clientY }
        : null;
  };
  const onEnd = (event: Event) => {
    const touch = (event as TouchEvent).changedTouches[0];
    const from = start;
    start = null;
    if (!from || !doc.defaultView?.getSelection()?.isCollapsed) return;
    const dx = touch.clientX - from.x;
    if (Math.abs(dx) > 60 && Math.abs(touch.clientY - from.y) < 40)
      flip(dx < 0 ? 'next' : 'prev');
  };
  target.addEventListener('touchstart', onStart, { passive: true });
  target.addEventListener('touchend', onEnd, { passive: true });
  return () => {
    target.removeEventListener('touchstart', onStart);
    target.removeEventListener('touchend', onEnd);
  };
}
