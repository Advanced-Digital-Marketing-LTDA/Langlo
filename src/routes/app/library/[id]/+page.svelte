<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { languageNames } from '../../../../lib/languageNames';
  import LibraryLookup from '../../../../lib/components/LibraryLookup.svelte';
  import { mountTextReader } from '../../../../lib/library/text-reader';
  import type {
    ReaderOptions,
    ReaderPosition,
    ReaderRenderer,
    ReaderSelection
  } from '../../../../lib/library/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let host: HTMLElement;
  let renderer: ReaderRenderer | null = null;
  let position = $state<ReaderPosition | null>(null);
  let selection = $state<ReaderSelection | null>(null);
  let savedTerms = $state<string[]>([]);
  let message = $state('');
  let loading = $state(true);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let firstPosition = true;

  let pendingSave: ReaderPosition | null = null;

  async function savePosition(next: ReaderPosition, keepalive = false) {
    try {
      const response = await fetch(
        `/app/api/library/${encodeURIComponent(data.document.id)}`,
        {
          method: 'PATCH',
          keepalive,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            location: next.location,
            fraction: next.fraction
          })
        }
      );
      if (!response.ok) message = 'Your place could not be saved.';
    } catch {
      message = 'Your place could not be saved. Check your connection.';
    }
  }

  // One save at a time, so an older place cannot overwrite a newer one.
  let saving = false;
  let queuedSave: ReaderPosition | null = null;
  async function sendPosition(next: ReaderPosition) {
    if (saving) {
      queuedSave = next;
      return;
    }
    saving = true;
    try {
      await savePosition(next);
    } finally {
      saving = false;
    }
    const waiting = queuedSave;
    queuedSave = null;
    if (waiting) await sendPosition(waiting);
  }

  function onPosition(next: ReaderPosition) {
    position = next;
    selection = null;
    // The place the reader opened at is already saved.
    if (firstPosition) {
      firstPosition = false;
      return;
    }
    clearTimeout(saveTimer);
    pendingSave = next;
    saveTimer = setTimeout(() => {
      pendingSave = null;
      void sendPosition(next);
    }, 500);
  }

  // Leaving the page must not lose the last page turned.
  function flushPosition() {
    clearTimeout(saveTimer);
    const next = pendingSave ?? queuedSave;
    pendingSave = null;
    queuedSave = null;
    if (next) void savePosition(next, true);
  }
  beforeNavigate(flushPosition);

  async function originalBytes() {
    const response = await fetch(
      `/app/api/library/${encodeURIComponent(data.document.id)}/file`
    );
    if (!response.ok) throw new Error('The book could not be loaded.');
    return new Uint8Array(await response.arrayBuffer());
  }

  async function mount(options: ReaderOptions): Promise<ReaderRenderer> {
    const format = data.document.originalFormat;
    if (!format) return mountTextReader(options, data.text ?? '');
    const bytes = await originalBytes();
    if (format === 'pdf')
      return (
        await import('../../../../lib/library/pdf-reader')
      ).mountPdfReader(options, bytes);
    if (format === 'docx')
      return (
        await import('../../../../lib/library/docx-reader')
      ).mountDocxReader(options, bytes);
    return (
      await import('../../../../lib/library/epub-reader')
    ).mountEpubReader(options, bytes);
  }

  // Documents read before page positions saved only a sentence index.
  function legacyFraction() {
    const { progressLocation, progressIndex, sentenceCount } = data.document;
    if (progressLocation || !sentenceCount) return 0;
    return Math.min(progressIndex / sentenceCount, 1);
  }

  onMount(() => {
    let disposed = false;
    savedTerms = data.savedTerms;
    mount({
      container: host,
      language: data.document.language,
      location: data.document.progressLocation,
      legacyFraction: legacyFraction(),
      savedTerms,
      onPosition,
      onSelect: (next) => {
        message = '';
        selection = next;
      },
      onError: (text) => (message = text)
    })
      .then((mounted) => {
        if (disposed) mounted.destroy();
        else renderer = mounted;
      })
      .catch((error: Error) => {
        message = error.message || 'The book could not be opened.';
      })
      .finally(() => (loading = false));
    return () => {
      disposed = true;
      flushPosition();
      renderer?.destroy();
    };
  });

  function flip(direction: 'next' | 'prev') {
    selection = null;
    void (direction === 'next' ? renderer?.next() : renderer?.prev());
  }

  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    // Modified arrows move or extend a text selection.
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)
      return;
    if (event.key === 'ArrowRight') flip('next');
    if (event.key === 'ArrowLeft') flip('prev');
  }

  function saved(term: string) {
    savedTerms = [...new Set([...savedTerms, term])];
    renderer?.markSaved(savedTerms);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head>
  <title>{data.document.title} · Library · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<p><a href="/app/library">Back to Library</a></p>
<h1>{data.document.title}</h1>
<p>{languageNames[data.document.language] ?? data.document.language}</p>

{#if message}<p class="error-box" role="alert">{message}</p>{/if}

<section class="reader" class:with-lookup={selection} aria-label="Reader">
  <div
    class="window"
    class:loading
    bind:this={host}
    lang={data.document.language}
  ></div>
  <div class="pager">
    <button onclick={() => flip('prev')} disabled={!position?.canPrev}
      >Previous page</button
    >
    <span aria-live="polite"
      >{loading ? 'Loading…' : (position?.label ?? '')}</span
    >
    <button onclick={() => flip('next')} disabled={!position?.canNext}
      >Next page</button
    >
  </div>
  <p class="hint">
    Select a word or phrase to translate and explain it. Click a word, or press
    and hold on a phone.
  </p>
</section>

{#if selection}
  <LibraryLookup
    documentId={data.document.id}
    {selection}
    decks={data.decks}
    deckHint={languageNames[data.document.language] ?? data.document.language}
    onSaved={saved}
    onClose={() => (selection = null)}
  />
{/if}

<style>
  .window {
    height: min(75vh, 60rem);
    overflow: auto;
    background: white;
    border: 1px solid #b9c6d6;
    border-radius: 0.5rem;
    position: relative;
  }
  .window.loading {
    opacity: 0.5;
  }
  /* The lookup bar covers the bottom of the screen on a phone. */
  @media (max-width: 700px), (pointer: coarse) {
    .reader.with-lookup {
      padding-bottom: 16rem;
    }
  }
  .pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin: 0.75rem 0;
  }
  .hint {
    color: #49617a;
    font-size: 0.9rem;
  }
  .window :global(.text-page) {
    max-width: 42rem;
    margin: 0 auto;
    padding: 1.5rem;
    font-size: 1.15rem;
    line-height: 1.75;
  }
  .window :global(.pdf-holder) {
    display: flex;
    justify-content: center;
  }
  .window :global(.pdf-page) {
    position: relative;
  }
  .window :global(.pdf-page canvas) {
    display: block;
  }
  .window :global(.textLayer mark) {
    color: transparent;
    background: rgb(255 214 0 / 0.45);
  }
  .window :global(.docx-holder) {
    background: #e5eaf1;
  }
  .window :global(.docx-holder .docx-wrapper) {
    padding: 0.5rem;
    background: transparent;
  }
  .window :global(.epub-holder) {
    height: 100%;
  }
  .window :global(mark[data-saved]) {
    background: rgb(255 214 0 / 0.45);
    color: inherit;
  }
</style>
