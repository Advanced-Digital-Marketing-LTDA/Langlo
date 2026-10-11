<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import Chip from '../../../lib/prototype/Chip.svelte';
  import StateSwitcher from '../../../lib/prototype/StateSwitcher.svelte';
  import { outcomeLabel, practiceItems } from '../../../lib/prototype/data';
  import { prototypeSession } from '../../../lib/prototype/session.svelte';
  import {
    recordRunAnswer,
    type SessionAnswer
  } from '../../../lib/prototype/results';

  // A completed run's answers stay recorded across navigation — they are
  // only replaced when a new run's first item is actually answered.
  const recordAnswer = (answer: SessionAnswer) =>
    recordRunAnswer(prototypeSession, answer, index === 0);

  const screenState = $derived(page.url.searchParams.get('state') ?? 'normal');

  let index = $state(0);
  let phase = $state<'answering' | 'feedback'>('answering');
  let selected = $state('');
  let typed = $state('');
  let outcome = $state<'correct' | 'incorrect' | 'uncertain'>('correct');
  let counts = $state({ correct: 0, incorrect: 0, uncertain: 0 });
  let nextButton: HTMLElement | undefined = $state();

  const item = $derived(practiceItems[index]);
  const isLast = $derived(index === practiceItems.length - 1);
  const canSubmit = $derived(
    item.format === 'multiple-choice' ? selected !== '' : typed.trim() !== ''
  );
  const resultsHref = $derived(
    `${resolve('/prototype/results')}?correct=${counts.correct}&incorrect=${counts.incorrect}&uncertain=${counts.uncertain}`
  );

  function normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  async function submit() {
    if (!canSubmit || phase !== 'answering') return;
    const answer =
      item.format === 'multiple-choice' ? selected : normalize(typed);
    outcome = item.acceptable?.some((ok) => normalize(ok) === normalize(answer))
      ? 'correct'
      : 'incorrect';
    counts[outcome] += 1;
    recordAnswer({
      prompt: item.prompt,
      yourAnswer: item.format === 'multiple-choice' ? selected : typed.trim(),
      expected: item.sampleAnswer,
      outcome
    });
    phase = 'feedback';
    await tick();
    nextButton?.focus();
  }

  async function notSure() {
    if (phase !== 'answering') return;
    outcome = 'uncertain';
    counts.uncertain += 1;
    recordAnswer({
      prompt: item.prompt,
      yourAnswer: '',
      expected: item.sampleAnswer,
      outcome
    });
    phase = 'feedback';
    await tick();
    nextButton?.focus();
  }

  function next() {
    index += 1;
    phase = 'answering';
    selected = '';
    typed = '';
  }
</script>

<svelte:head><title>Practice | Langlo prototype</title></svelte:head>

<StateSwitcher states={['normal', 'loading', 'error']} />

<h1>Practice · French A1</h1>

{#if screenState === 'loading'}
  <div class="panel" aria-busy="true" aria-label="Loading next exercise">
    <div class="skel"></div>
    <div class="skel short"></div>
    <p class="muted">Preparing your next exercise…</p>
  </div>
{:else if screenState === 'error'}
  <div class="panel" role="alert">
    <h2>Answer could not be submitted</h2>
    <p>
      Nothing was recorded. Submitting again is safe — a retried answer cannot
      create a duplicate attempt.
    </p>
    <a class="button" href={resolve('/prototype/practice')}>Retry</a>
    <a href={resolve('/prototype')}>Exit session</a>
  </div>
{:else}
  <p class="progress" role="status">
    Item {index + 1} of {practiceItems.length} · {item.formatLabel} · Practice session
  </p>

  <form
    class="panel"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <fieldset disabled={phase === 'feedback'}>
      <legend class="prompt">{item.prompt}</legend>

      {#if item.hint}
        <p class="hint">Hint: {item.hint}</p>
      {/if}

      {#if item.format === 'multiple-choice'}
        <div class="options" role="radiogroup" aria-label="Answer options">
          {#each item.options ?? [] as option (option)}
            <label class="option">
              <input
                type="radio"
                name="answer"
                value={option}
                bind:group={selected}
              />
              {option}
            </label>
          {/each}
        </div>
      {:else}
        <label class="typed">
          Your answer
          <input
            type="text"
            bind:value={typed}
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </label>
      {/if}
    </fieldset>

    {#if phase === 'answering'}
      <div class="actions">
        <button class="button" type="submit" disabled={!canSubmit}>
          Submit answer
        </button>
        <button class="secondary" type="button" onclick={notSure}>
          Not sure
        </button>
      </div>
    {:else}
      <div class="feedback" role="status">
        <p>
          {#if outcome === 'correct'}
            <Chip variant="outcome" symbol="✓" label={outcomeLabel.correct} />
          {:else if outcome === 'incorrect'}
            <Chip variant="outcome" symbol="✗" label={outcomeLabel.incorrect} />
          {:else}
            <Chip variant="outcome" symbol="?" label={outcomeLabel.uncertain} />
          {/if}
        </p>
        <p>
          {item.explanation}
          {#if outcome !== 'correct'}
            <br />Accepted answer: <strong>{item.sampleAnswer}</strong>
          {/if}
        </p>
      </div>
      <div class="actions">
        {#if isLast}
          <a class="button" href={resultsHref} bind:this={nextButton}
            >See results</a
          >
        {:else}
          <button
            class="button"
            type="button"
            onclick={next}
            bind:this={nextButton}
          >
            Next item
          </button>
        {/if}
      </div>
    {/if}
  </form>
{/if}

<style>
  .progress {
    color: #49617a;
    font-weight: 600;
  }
  .panel {
    padding: 1.5rem;
    background: white;
    border: 1px solid #d9e2ef;
    border-radius: 0.8rem;
  }
  fieldset {
    border: none;
    margin: 0;
    padding: 0;
  }
  fieldset:disabled {
    opacity: 0.75;
  }
  .prompt {
    font-size: 1.25rem;
    font-weight: 650;
    margin-bottom: 0.8rem;
    padding: 0;
  }
  .hint {
    color: #49617a;
    font-size: 0.9rem;
  }
  .options {
    display: grid;
    gap: 0.6rem;
    margin: 1rem 0;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 44px;
    padding: 0.5rem 0.8rem;
    border: 1px solid #d9e2ef;
    border-radius: 0.6rem;
    cursor: pointer;
    font-size: 1.05rem;
  }
  .option:has(input:checked) {
    border-color: #1b5982;
    background: #eef4fb;
    font-weight: 650;
  }
  .option input {
    width: 1.2rem;
    height: 1.2rem;
  }
  .typed {
    display: block;
    font-weight: 600;
  }
  .typed input {
    display: block;
    margin-top: 0.4rem;
    padding: 0.7rem 0.9rem;
    font-size: 1.05rem;
    border: 1px solid #b8c6d8;
    border-radius: 0.6rem;
    width: 100%;
    max-width: 28rem;
    min-height: 44px;
  }
  .actions {
    display: flex;
    gap: 0.8rem;
    align-items: center;
    margin-top: 1.25rem;
    flex-wrap: wrap;
  }
  .button {
    min-height: 44px;
    padding: 0.5rem 1.2rem;
    background: #1b5982;
    color: white;
    border: none;
    border-radius: 0.6rem;
    text-decoration: none;
    font-weight: 650;
    font-size: 1rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }
  .button:disabled {
    background: #9db4c8;
    cursor: not-allowed;
  }
  .secondary {
    min-height: 44px;
    padding: 0.5rem 1.2rem;
    background: white;
    color: #172d46;
    border: 1px solid #b8c6d8;
    border-radius: 0.6rem;
    font-weight: 650;
    font-size: 1rem;
    cursor: pointer;
  }
  .feedback {
    margin-top: 1.25rem;
    padding: 0.8rem 1rem;
    background: #f5f7fb;
    border: 1px solid #d9e2ef;
    border-radius: 0.6rem;
  }
  .muted {
    color: #49617a;
    font-size: 0.9rem;
  }
  .skel {
    height: 1.1rem;
    border-radius: 0.4rem;
    background: #e8eef6;
    margin-bottom: 0.8rem;
  }
  .skel.short {
    width: 55%;
  }
</style>
