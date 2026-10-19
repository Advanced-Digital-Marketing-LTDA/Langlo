<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const summary = $derived(data.summary);
</script>

<svelte:head>
  <title>Practice results · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Practice results</h1>
<p>
  {summary.answered} answers: {summary.correct} correct, {summary.incorrect}
  incorrect, {summary.uncertain} uncertain{#if summary.pending}, {summary.pending}
    still being checked{/if}.
</p>
<p>Practice answers are separate from assessments and from flashcard recall.</p>
{#if form?.saved}
  <p role="status">
    Saved as a draft. <a href="/app/decks">Approve it in Decks</a>.
  </p>
{/if}
{#if data.mistakes.length}
  <h2>Mistakes to keep</h2>
  <ul>
    {#each data.mistakes as mistake (mistake.attemptId)}
      <li>
        <strong>{mistake.prompt}</strong>
        — {mistake.answer}
        {#if mistake.draftStatus === 'draft'}
          <span
            >Kept as a draft. Approve it in <a href="/app/decks">Decks</a
            >.</span
          >
        {:else if mistake.draftStatus === 'approved'}
          <span>Approved as a flashcard.</span>
        {:else if mistake.draftStatus === 'rejected'}
          <span>Rejected; this mistake will not become a flashcard.</span>
        {:else}
          <form method="POST" action="?/keep" use:enhance>
            <input type="hidden" name="attemptId" value={mistake.attemptId} />
            {#if mistake.prompt.includes('___')}
              <label
                >Card type
                <select name="format">
                  <option value="basic">Basic (front and back)</option>
                  <option value="cloze">Cloze (hide the answer)</option>
                </select>
              </label>
            {:else}
              <input type="hidden" name="format" value="basic" />
            {/if}
            <button type="submit">Keep as flashcard</button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
{#if summary.state !== 'completed'}
  <p>
    <a href={`/app/session/${encodeURIComponent(summary.id)}`}
      >Continue session</a
    >
  </p>
{/if}
<p>
  <a href="/app/map">Grammar skill map</a> · <a href="/app">Back to home</a>
</p>
