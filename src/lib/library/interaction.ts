import {
  collapseWhitespace,
  locateSelection,
  sentenceContext,
  snapToWords
} from '../library-text';
import { selectionStartHint } from './occurrence';
import type { ReaderSelection } from './types';

const maxTermLength = 256;

/** The word segment around a collapsed caret, selected in place. */
function selectWordAtCaret(doc: Document, language: string): boolean {
  const selection = doc.defaultView?.getSelection();
  const node = selection?.anchorNode;
  if (!selection || node?.nodeType !== 3) return false;
  const caret = selection.anchorOffset;
  const words = new Intl.Segmenter(language, { granularity: 'word' });
  const part = Array.from(words.segment((node as Text).data)).find(
    (item) =>
      item.isWordLike &&
      caret >= item.index &&
      caret <= item.index + item.segment.length
  );
  if (!part) return false;
  const range = doc.createRange();
  range.setStart(node, part.index);
  range.setEnd(node, part.index + part.segment.length);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

type SelectionRead = { selection: ReaderSelection } | { error: string } | null;

/** The non-empty selection inside `root`, with its text. */
function selectedRange(win: Window, root: HTMLElement) {
  const selection = win.getSelection();
  if (!selection?.rangeCount) return null;
  if (selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString();
  return text.trim() ? { range, text } : null;
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
    selectionStartHint(
      page,
      collapseWhitespace(before.toString()),
      collapseWhitespace(text)
    )
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

type SelectionOptions = {
  /** The element holding the page being read; a function when it changes. */
  root: HTMLElement | (() => HTMLElement);
  language: string;
  frame?: HTMLElement;
  onSelect: (selection: ReaderSelection) => void;
  onError: (message: string) => void;
};

/** Pass a read result to the matching callback; false when nothing is selected. */
function deliver(
  result: SelectionRead,
  { onSelect, onError }: Pick<SelectionOptions, 'onSelect' | 'onError'>
) {
  if (!result) return false;
  if ('error' in result) onError(result.error);
  else onSelect(result.selection);
  return true;
}

export type SelectionWatch = {
  stop: () => void;
  /** Look up the current selection now; false when nothing is selected. */
  read: () => boolean;
};

/** A primary-button click made with a mouse rather than touch or a pen. */
const isMouseClick = (event: MouseEvent, pointer: string) =>
  event.button === 0 && pointer === 'mouse';

/** After a click, select the word under the caret unless text is dragged. */
function settleMouseSelection(win: Window, doc: Document, language: string) {
  const collapsed = win.getSelection()?.isCollapsed;
  return !collapsed || selectWordAtCaret(doc, language);
}

/**
 * Report the word or phrase the learner selects inside `root`: a click or a
 * drag with the mouse, or a press-and-hold selection with touch. `frame` is
 * the iframe element when `root` lives in one.
 */
export function watchSelection(options: SelectionOptions): SelectionWatch {
  const { language, frame } = options;
  const rootOf = () =>
    typeof options.root === 'function' ? options.root() : options.root;
  const doc = rootOf().ownerDocument;
  const win = doc.defaultView;
  if (!win) return { stop: () => undefined, read: () => false };
  let pointer = 'mouse';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const read = () =>
    deliver(readSelection(win, rootOf(), language, frame), options);

  const onPointerDown = (event: PointerEvent) => {
    pointer = event.pointerType;
  };
  // Shift with the arrow keys extends a selection like a press-and-hold does.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.shiftKey) pointer = 'keyboard';
  };
  const onMouseUp = (event: MouseEvent) => {
    if (!isMouseClick(event, pointer)) return;
    if (!rootOf().contains(event.target as Node)) return;
    // Wait a tick so the browser has settled the selection after the click.
    setTimeout(() => {
      if (settleMouseSelection(win, doc, language)) read();
    });
  };
  const onSelectionChange = () => {
    if (pointer === 'mouse') return;
    clearTimeout(timer);
    timer = setTimeout(read, 400);
  };

  doc.addEventListener('pointerdown', onPointerDown);
  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('mouseup', onMouseUp);
  doc.addEventListener('selectionchange', onSelectionChange);
  const stop = () => {
    clearTimeout(timer);
    doc.removeEventListener('pointerdown', onPointerDown);
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('mouseup', onMouseUp);
    doc.removeEventListener('selectionchange', onSelectionChange);
  };
  return { stop, read };
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
