<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
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
