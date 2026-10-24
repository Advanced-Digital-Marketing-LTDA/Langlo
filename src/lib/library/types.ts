export type ReaderSelection = {
  term: string;
  sentence: string;
  previousSentence: string;
  nextSentence: string;
  /** Viewport coordinates of the selection, for placing the lookup panel. */
  rect: { top: number; bottom: number; left: number; right: number };
};

export type ReaderPosition = {
  /** Page number or EPUB location, as saved on the document. */
  location: string;
  /** How far through the book the reader is, from 0 to 1. */
  fraction: number;
  label: string;
  canPrev: boolean;
  canNext: boolean;
};

export type ReaderOptions = {
  container: HTMLElement;
  language: string;
  location: string | null;
  /** Progress saved before page positions existed, from 0 to 1. */
  legacyFraction: number;
  savedTerms: string[];
  onPosition: (position: ReaderPosition) => void;
  onSelect: (selection: ReaderSelection) => void;
  onError: (message: string) => void;
};

export type ReaderRenderer = {
  next: () => Promise<void>;
  prev: () => Promise<void>;
  markSaved: (terms: string[]) => void;
  destroy: () => void;
};
