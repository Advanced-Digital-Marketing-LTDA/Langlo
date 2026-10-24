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

type SelectionRead = { selection: ReaderSelection } | { error: string } | null;

/** The non-empty selection inside `root`, with its text. */
function selectedRange(win: Window, root: HTMLElement) {
  const selection = win.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const text = selection.toString();
  if (!root.contains(range.commonAncestorContainer) || !text.trim())
    return null;
  return { range, text };
}

/** `range`'s rectangle in viewport coordinates, shifted by its iframe. */
function viewportRect(range: Range, frame?: HTMLElement) {
  const frameBox = frame?.getBoundingClientRect();
  const box = range.getBoundingClientRect();
  const dx = frameBox?.left ?? 0;
  const dy = frameBox?.top ?? 0;
  return {
    top: box.top + dy,
    bottom: box.bottom + dy,
    left: box.left + dx,
    right: box.right + dx
  };
}

/** The phrase selected inside `root` with its sentence context, or an error. */
function readSelection(
  win: Window,
  root: HTMLElement,
  language: string,
  frame?: HTMLElement
): SelectionRead {
  const picked = selectedRange(win, root);
  if (!picked) return null;
  const { range, text } = picked;
  const before = root.ownerDocument.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const page = collapseWhitespace(root.innerText);
  const located = locateSelection(
    page,
    text,
    collapseWhitespace(before.toString()).length
  );
  const snapped = located && snapToWords(page, located.start, located.end);
  if (!snapped) return { error: 'Select a word or phrase in the text.' };
  if (snapped.text.length > maxTermLength)
    return { error: 'Select a shorter word or phrase.' };
  return {
    selection: {
      term: snapped.text,
      ...sentenceContext(page, snapped.start, snapped.end, language),
      rect: viewportRect(range, frame)
    }
  };
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
    const result = readSelection(win, rootOf(), language, frame);
    if (!result) return;
    if ('error' in result) options.onError(result.error);
    else options.onSelect(result.selection);
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
