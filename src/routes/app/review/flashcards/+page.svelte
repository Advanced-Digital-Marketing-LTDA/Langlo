<script lang="ts">
  import { enhance } from '$app/forms';
  import StudyTimer from '../../../../lib/components/StudyTimer.svelte';
  import { hydration } from '../../../../lib/hydration.svelte';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let revealed = $state(false);
  const card = $derived(data.cards[0]);
  const ratings = ['again', 'hard', 'good', 'easy'] as const;
  const hideCloze = (text = '') =>
    text.replace(/\{\{c1::[^{}]+\}\}/gu, '[...]');
  const front = $derived(
    card?.kind === 'basic' ? card.content.front : hideCloze(card?.content.text)
  );
</script>

<svelte:head>
  <title>Review · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>
<StudyTimer category="flashcards" />

<h1>Review</h1>
{#if form?.message}<p class="error-box" role="alert">{form.message}</p>{/if}
{#if data.unavailableCount}
  <p role="alert">
    {data.unavailableCount} due {data.unavailableCount === 1
      ? 'card needs'
      : 'cards need'} repair before review.
  </p>
{/if}
{#if card}
  <p data-testid="remaining-due">
    {data.total} due{data.total > data.cards.length
      ? `, showing the first ${data.cards.length}`
      : ''}. Deck: {card.deck}
  </p>
  <p><strong>{front}</strong></p>
  {#if !revealed}
    <button
      type="button"
      disabled={!hydration.ready}
      onclick={() => (revealed = true)}>Show answer</button
    >
  {:else}
    <p>{card.kind === 'basic' ? card.content.back : card.content.text}</p>
    {#if card.explanation}
      <p><strong>Explanation:</strong> {card.explanation}</p>
    {/if}
    <form
      method="POST"
      action={`?language=${encodeURIComponent(data.language)}&due=${data.due}&/rate`}
      use:enhance={() =>
        async ({ update }) => {
          revealed = false;
          await update();
        }}
    >
      <input type="hidden" name="cardId" value={card.id} />
      <input type="hidden" name="revision" value={card.revision} />
      <input type="hidden" name="scheduleKey" value={card.scheduleKey} />
      <input type="hidden" name="submissionKey" value={data.submissionKey} />
      {#each ratings as rating (rating)}
        <button type="submit" name="rating" value={rating}
          >{rating} · {card.intervals[rating]}</button
        >
      {/each}
    </form>
  {/if}
{:else}
  <p>
    {data.total
      ? 'No reviewable cards right now.'
      : 'Nothing is due right now.'}
  </p>
{/if}
<p>
  <a href={`/app/review?language=${encodeURIComponent(data.language)}`}
    >Back to review</a
  >
  · <a href="/app/decks">Decks</a> · <a href="/app">Back to home</a>
</p>
