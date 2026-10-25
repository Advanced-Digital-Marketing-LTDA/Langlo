import { highlightSavedTerms } from '../library-text';

/** Remove every saved-word highlight under `root`, restoring plain text. */
export function unmarkSavedTerms(root: Element) {
  for (const mark of Array.from(root.querySelectorAll('mark[data-saved]')))
    mark.replaceWith(...Array.from(mark.childNodes));
  root.normalize();
}

/** The text node's content with each saved term wrapped in a `<mark>`. */
function markedFragment(doc: Document, text: string, terms: string[]) {
  const parts = highlightSavedTerms(text, terms);
  if (parts.length === 1 && !parts[0].saved) return null;
  const fragment = doc.createDocumentFragment();
  for (const part of parts) {
    if (!part.saved) {
      fragment.append(doc.createTextNode(part.text));
      continue;
    }
    const mark = doc.createElement('mark');
    mark.dataset.saved = '';
    mark.textContent = part.text;
    fragment.append(mark);
  }
  return fragment;
}

/** Highlight the learner's saved words in the text nodes under `root`. */
export function markSavedTerms(root: Element, terms: string[]) {
  unmarkSavedTerms(root);
  if (!terms.length) return;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const fragment = markedFragment(doc, node.data, terms);
    if (fragment) node.replaceWith(fragment);
  }
}
