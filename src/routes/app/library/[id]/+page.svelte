<script lang="ts">
  import { languageNames } from '../../../../lib/languageNames';
  import { highlightSavedTerms } from '../../../../lib/library-text';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let sentenceIndex = $state(0);
  let savedTerms = $state<string[]>([]);
  let term = $state('');
  let translation = $state('');
  let definition = $state('');
  let message = $state('');
  let status = $state('');
  let translationVisible = $state(false);
  let busy = $state(false);
  let selectedDeck = $state('');
  $effect(() => {
    sentenceIndex = data.document.progressIndex;
    savedTerms = data.savedTerms;
    selectedDeck = data.decks[0]?.id ?? '';
  });
  const sentence = $derived(data.sentences[sentenceIndex] ?? '');
  const highlighted = $derived(highlightSavedTerms(sentence, savedTerms));
  const wordSegmenter = $derived(
    new Intl.Segmenter(data.document.language, { granularity: 'word' })
  );

  async function moveTo(index: number) {
    if (busy) return;
    busy = true;
    message = '';
    status = '';
    try {
      const response = await fetch(
        `/app/api/library/${encodeURIComponent(data.document.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ progressIndex: index })
        }
      );
      if (!response.ok) {
        message = 'Progress could not be saved. Try again.';
        return;
      }
      sentenceIndex = index;
      translation = '';
      translationVisible = false;
      definition = '';
      term = '';
    } catch {
      message =
        'Progress could not be saved. Check your connection and try again.';
    } finally {
      busy = false;
    }
  }

  async function requestStudy(action: 'translate' | 'lookup') {
    if (busy) return;
    message = '';
    status = '';
    busy = true;
    try {
      const response = await fetch(
        `/app/api/library/${encodeURIComponent(data.document.id)}/study`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action,
            sentenceIndex,
            ...(action === 'lookup' ? { term } : {})
          })
        }
      );
      const body = (await response.json()) as {
        result?: string;
        message?: string;
      };
      if (!response.ok || !body.result) {
        message = body.message ?? 'The request could not be completed.';
      } else if (action === 'translate') {
        translation = body.result;
        translationVisible = true;
      } else {
        definition = body.result;
      }
    } catch {
      message =
        'The request could not be completed. Check your connection and try again.';
    } finally {
      busy = false;
    }
  }

  async function saveVocabulary() {
    if (busy) return;
    const submittedTerm = term.trim();
    message = '';
    status = '';
    busy = true;
    try {
      const response = await fetch(
        `/app/api/library/${encodeURIComponent(data.document.id)}/vocabulary`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deckId: selectedDeck,
            term: submittedTerm,
            definition
          })
        }
      );
      const body = (await response.json()) as {
        message?: string;
        note?: { status?: string };
      };
      if (!response.ok) {
        message = body.message ?? 'The word could not be saved.';
      } else if (body.note?.status === 'rejected') {
        status = 'This vocabulary card was previously rejected.';
      } else {
        savedTerms = [...new Set([...savedTerms, submittedTerm])];
        status =
          body.note?.status === 'approved'
            ? 'This vocabulary is already an approved flashcard.'
            : 'Saved as a native flashcard draft.';
      }
    } catch {
      message =
        'The word could not be saved. Check your connection and try again.';
    } finally {
      busy = false;
    }
  }

  async function showTranslation() {
    if (translation) translationVisible = true;
    else await requestStudy('translate');
  }

  async function lookupWord(word: string) {
    if (busy) return;
    term = word;
    definition = '';
    await requestStudy('lookup');
  }
</script>

{#snippet words(text: string)}
  {#each Array.from(wordSegmenter.segment(text)) as word (word.index)}
    {#if word.isWordLike}<button
        class="word"
        aria-label={`Look up ${word.segment}`}
        disabled={busy}
        onclick={() => lookupWord(word.segment)}>{word.segment}</button
      >{:else}{word.segment}{/if}
  {/each}
{/snippet}

<svelte:head>
  <title>{data.document.title} · Library · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<p><a href="/app/library">Back to Library</a></p>
<h1>{data.document.title}</h1>
<p>{languageNames[data.document.language] ?? data.document.language}</p>

{#if message}<p class="error-box" role="alert">{message}</p>{/if}
{#if status}<p role="status">{status}</p>{/if}

{#if sentenceIndex >= data.sentences.length}
  <section aria-labelledby="complete-heading">
    <h2 id="complete-heading">Document complete</h2>
    <p>You reached the end of this document.</p>
    <button onclick={() => moveTo(0)}>Start again</button>
  </section>
{:else}
  <section aria-labelledby="reader-heading">
    <h2 id="reader-heading">
      Sentence {sentenceIndex + 1} of {data.sentences.length}
    </h2>
    <p aria-live="polite">
      {#each highlighted as part, index (`${index}-${part.text}`)}
        {#if part.saved}<mark>{@render words(part.text)}</mark
          >{:else}{@render words(part.text)}{/if}
      {/each}
    </p>
    <div>
      <button
        onclick={() => moveTo(Math.max(0, sentenceIndex - 1))}
        disabled={sentenceIndex === 0 || busy}>Previous</button
      >
      <button onclick={() => moveTo(sentenceIndex + 1)} disabled={busy}
        >Next sentence</button
      >
    </div>
  </section>

  <section aria-labelledby="translation-heading">
    <h2 id="translation-heading">Translation</h2>
    {#if translation && translationVisible}
      <p>{translation}</p>
      <button onclick={() => (translationVisible = false)}
        >Hide translation</button
      >
    {:else}
      <button onclick={showTranslation} disabled={busy}
        >Show translation in {data.targetLanguage === 'pt'
          ? 'Portuguese'
          : 'English'}</button
      >
    {/if}
  </section>

  <section aria-labelledby="vocabulary-heading">
    <h2 id="vocabulary-heading">Word or phrase</h2>
    <label>
      Select a word or phrase from this sentence
      <input
        bind:value={term}
        maxlength="256"
        disabled={busy}
        oninput={() => {
          definition = '';
          message = '';
          status = '';
        }}
      />
    </label>
    <button
      onclick={() => requestStudy('lookup')}
      disabled={busy || !term.trim()}>Look up in context</button
    >
    {#if definition}
      <p>{definition}</p>
      {#if data.decks.length}
        <label>
          Save to deck
          <select bind:value={selectedDeck} disabled={busy}>
            {#each data.decks as deck (deck.id)}
              <option value={deck.id}>{deck.name}</option>
            {/each}
          </select>
        </label>
        <button onclick={saveVocabulary} disabled={busy}>Save word draft</button
        >
      {:else}
        <p>
          Create a {languageNames[data.document.language]} deck on the
          <a href="/app/decks">Decks page</a> to save words.
        </p>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .word {
    display: inline;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .word:hover,
  .word:focus-visible {
    text-decoration: underline;
  }
</style>
