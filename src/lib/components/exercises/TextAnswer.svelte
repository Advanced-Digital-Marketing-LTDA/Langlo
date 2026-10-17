<script lang="ts">
  import { accentsFor } from './answer';

  let {
    id,
    name,
    label,
    language,
    multiline = false,
    value = $bindable(''),
    describedby
  }: {
    id: string;
    name: string;
    label: string;
    language: string;
    multiline?: boolean;
    value?: string;
    describedby?: string | undefined;
  } = $props();

  let field: HTMLInputElement | HTMLTextAreaElement | undefined = $state();
  const accents = $derived(accentsFor(language));

  // Insert at the caret so a learner without an accented keyboard can still
  // type the answer, then put the caret back after the new letter.
  function insert(letter: string) {
    if (!field) return;
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? start;
    value = value.slice(0, start) + letter + value.slice(end);
    const caret = start + letter.length;
    queueMicrotask(() => {
      field?.focus();
      field?.setSelectionRange(caret, caret);
    });
  }
</script>

<div class="answer">
  <label for={id}>{label}</label>
  {#if multiline}
    <textarea
      {id}
      {name}
      lang={language}
      rows="4"
      autocapitalize="off"
      autocomplete="off"
      spellcheck="false"
      aria-describedby={describedby}
      bind:this={field}
      bind:value></textarea>
  {:else}
    <input
      {id}
      {name}
      type="text"
      lang={language}
      autocapitalize="off"
      autocomplete="off"
      spellcheck="false"
      aria-describedby={describedby}
      bind:this={field}
      bind:value
    />
  {/if}
  {#if accents.length > 0}
    <div class="accents" role="group" aria-label="Accented letters">
      {#each accents as letter (letter)}
        <button type="button" lang={language} onclick={() => insert(letter)}>
          {letter}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .answer {
    display: grid;
    gap: 0.5rem;
  }

  input,
  textarea {
    border: 2px solid currentColor;
    border-radius: 0.5rem;
    font: inherit;
    min-height: 3rem;
    padding: 0.5rem 0.75rem;
    width: 100%;
  }

  .accents {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .accents button {
    font: inherit;
    min-height: 2.75rem;
    min-width: 2.75rem;
  }
</style>
