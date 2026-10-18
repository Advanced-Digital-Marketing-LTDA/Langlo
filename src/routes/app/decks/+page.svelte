<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>Decks · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Flashcard decks</h1>
{#if form?.message}<p class="error-box" role="alert">{form.message}</p>{/if}
{#if data.decks.length}
  <ul>
    {#each data.decks as deck (deck.id)}
      <li>
        <a href={`/app/decks/${encodeURIComponent(deck.id)}`}>{deck.name}</a>
      </li>
    {/each}
  </ul>
{:else}
  <p>You have no decks yet.</p>
{/if}
<form method="POST" action="?/createDeck" use:enhance>
  <label>Deck name <input name="name" required maxlength="160" /></label>
  <button type="submit">Create deck</button>
</form>
<p>
  <a href="/app/review">Review due cards</a> · <a href="/app">Back to home</a>
</p>
