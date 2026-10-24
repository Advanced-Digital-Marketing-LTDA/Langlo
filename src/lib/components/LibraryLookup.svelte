<script lang="ts">
  import type { ReaderSelection } from '../library/types';

  type Deck = { id: string; name: string };
  let {
    documentId,
    selection,
    decks,
    deckHint,
    onSaved,
    onClose
  }: {
    documentId: string;
    selection: ReaderSelection;
    decks: Deck[];
    deckHint: string;
    onSaved: (term: string) => void;
    onClose: () => void;
  } = $props();

  let lookup = $state<{ translation: string; explanation: string } | null>(
    null
  );
  let sentenceTranslation = $state('');
  let message = $state('');
  let status = $state('');
  let busy = $state(false);
  let deckId = $derived(decks[0]?.id ?? '');
  // A new selection starts a new lookup.
  $effect(() => {
    void selection;
    lookup = null;
    sentenceTranslation = '';
    message = '';
    status = '';
  });

  const base = $derived(`/app/api/library/${encodeURIComponent(documentId)}`);
  const context = $derived({
    sentence: selection.sentence,
    previousSentence: selection.previousSentence,
    nextSentence: selection.nextSentence
  });
  const placement = $derived(
    `--top:${Math.round(selection.rect.bottom + 8)}px;--left:${Math.round(selection.rect.left)}px`
  );

  async function post(path: string, body: unknown) {
    const response = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(
        typeof result.message === 'string'
          ? result.message
          : 'The request could not be completed.'
      );
    return result;
  }

  async function run(work: () => Promise<void>, failure: string) {
    if (busy) return;
    busy = true;
    message = '';
    status = '';
    try {
      await work();
    } catch (error) {
      message = error instanceof TypeError ? failure : (error as Error).message;
    } finally {
      busy = false;
    }
  }

  const explain = () =>
    run(async () => {
      const result = await post('study', {
        action: 'lookup',
        term: selection.term,
        ...context
      });
      lookup = {
        translation: String(result.translation),
        explanation: String(result.explanation)
      };
    }, 'The request could not be completed. Check your connection and try again.');

  const translateSentence = () =>
    run(async () => {
      const result = await post('study', { action: 'translate', ...context });
      sentenceTranslation = String(result.result);
    }, 'The request could not be completed. Check your connection and try again.');

  const save = () =>
    run(async () => {
      if (!lookup) return;
      const result = (await post('vocabulary', {
        deckId,
        term: selection.term,
        definition: `${lookup.translation} — ${lookup.explanation}`
      })) as { note?: { status?: string } };
      if (result.note?.status === 'rejected') {
        status = 'This vocabulary card was previously rejected.';
        return;
      }
      onSaved(selection.term);
      status =
        result.note?.status === 'approved'
          ? 'This vocabulary is already an approved flashcard.'
          : 'Saved as a native flashcard draft.';
    }, 'The word could not be saved. Check your connection and try again.');
</script>

<aside class="lookup" style={placement} aria-label="Look up the selection">
  <div class="head">
    <strong class="term">{selection.term}</strong>
    <button type="button" class="close" onclick={onClose} aria-label="Close"
      >✕</button
    >
  </div>
  <div class="actions">
    <button type="button" onclick={explain} disabled={busy}
      >Translate and explain</button
    >
    <button type="button" onclick={translateSentence} disabled={busy}
      >Translate sentence</button
    >
    <button type="button" onclick={save} disabled={busy || !lookup || !deckId}
      >Save to deck</button
    >
  </div>
  {#if decks.length > 1}
    <label class="deck">
      Deck
      <select bind:value={deckId} disabled={busy}>
        {#each decks as deck (deck.id)}
          <option value={deck.id}>{deck.name}</option>
        {/each}
      </select>
    </label>
  {:else if !decks.length}
    <p class="note">
      Create a {deckHint} deck on the <a href="/app/decks">Decks page</a> to save
      words.
    </p>
  {/if}
  {#if lookup}
    <p><strong>{lookup.translation}</strong></p>
    <p>{lookup.explanation}</p>
  {/if}
  {#if sentenceTranslation}<p class="sentence">{sentenceTranslation}</p>{/if}
  {#if message}<p class="error-box" role="alert">{message}</p>{/if}
  {#if status}<p role="status">{status}</p>{/if}
</aside>

<style>
  .lookup {
    position: fixed;
    z-index: 20;
    max-height: 60vh;
    overflow-y: auto;
    padding: 0.75rem 1rem;
    background: white;
    border: 1px solid #b9c6d6;
    border-radius: 0.5rem;
    box-shadow: 0 4px 18px rgb(23 45 70 / 0.25);
  }
  .lookup p {
    margin: 0.4rem 0;
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.5rem 0;
  }
  .sentence {
    font-style: italic;
  }
  @media (min-width: 701px) and (pointer: fine) {
    .lookup {
      top: min(var(--top), calc(100vh - 16rem));
      left: min(var(--left), calc(100vw - 26rem));
      width: 24rem;
    }
  }
  @media (max-width: 700px), (pointer: coarse) {
    .lookup {
      right: 0;
      bottom: 0;
      left: 0;
      border-radius: 0.75rem 0.75rem 0 0;
    }
    .actions button {
      flex: 1 1 8rem;
      min-height: 2.75rem;
    }
  }
</style>
