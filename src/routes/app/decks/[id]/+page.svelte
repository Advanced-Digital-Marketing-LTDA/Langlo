<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let kind = $state('basic');
</script>

<svelte:head>
  <title>{data.deck.name} · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>{data.deck.name}</h1>
{#if form?.message}<p class="error-box" role="alert">{form.message}</p>{/if}
{#if data.notes.length}
  <ul>
    {#each data.notes as note (note.id)}
      <li>
        {note.kind === 'basic'
          ? `${note.content.front} → ${note.content.back}`
          : note.content.text}
        <em>({note.status})</em>
        {#if note.status === 'draft'}
          <form method="POST" action="?/approve" use:enhance>
            <input type="hidden" name="noteId" value={note.id} />
            <button type="submit">Approve note</button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
{:else}
  <p>This deck has no notes yet.</p>
{/if}

<h2>Add a note</h2>
<form method="POST" action="?/addNote" use:enhance>
  <label
    >Type
    <select name="kind" bind:value={kind}>
      <option value="basic">Basic (front and back)</option>
      <option value="cloze">Cloze (hidden text)</option>
    </select>
  </label>
  {#if kind === 'basic'}
    <label>Front <input name="front" required maxlength="4096" /></label>
    <label>Back <input name="back" required maxlength="4096" /></label>
  {:else}
    <label
      >Text, with a hidden part like {'{{c1::answer}}'}
      <input name="text" required maxlength="4096" />
    </label>
  {/if}
  <button type="submit">Add note</button>
</form>
<p>
  <a href={`/app/decks/${encodeURIComponent(data.deck.id)}/export`}
    >Export approved notes for Anki</a
  >
  · <a href="/app/decks">All decks</a>
</p>
