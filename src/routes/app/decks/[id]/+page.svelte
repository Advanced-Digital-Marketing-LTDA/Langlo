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
{#if form?.saved}<p role="status">Saved.</p>{/if}
{#if data.notes.length}
  <ul>
    {#each data.notes as note (note.id)}
      <li
        id={`note-${note.id}`}
        aria-current={data.focusNoteId === note.id ? 'location' : undefined}
      >
        <p>
          {note.kind === 'basic'
            ? `${note.content.front} → ${note.content.back}`
            : note.content.text}
          <em>({note.status})</em>
        </p>
        {#if note.explanation}
          <p>{note.explanation}</p>
        {/if}
        {#if note.tags.length}
          <p>Tags: {note.tags.join(', ')}</p>
        {/if}
        {#if note.status === 'draft'}
          <form method="POST" action="?/approve" use:enhance>
            <input type="hidden" name="noteId" value={note.id} />
            <button type="submit">Approve note</button>
          </form>
        {/if}
        {#if note.status !== 'rejected'}
          <details>
            <summary>Edit note</summary>
            <form method="POST" action="?/edit" use:enhance>
              <input type="hidden" name="noteId" value={note.id} />
              <input type="hidden" name="kind" value={note.kind} />
              {#if note.kind === 'basic'}
                <label
                  >Front
                  <input
                    name="front"
                    required
                    maxlength="4096"
                    value={note.content.front}
                  />
                </label>
                <label
                  >Back
                  <input
                    name="back"
                    required
                    maxlength="4096"
                    value={note.content.back}
                  />
                </label>
              {:else}
                <label
                  >Text
                  <input
                    name="text"
                    required
                    maxlength="4096"
                    value={note.content.text}
                  />
                </label>
              {/if}
              <label
                >Explanation
                <input
                  name="explanation"
                  maxlength="1000"
                  value={note.explanation}
                />
              </label>
              <label
                >Tags (comma-separated)
                <input
                  name="tags"
                  maxlength="1320"
                  value={note.tags.join(', ')}
                />
              </label>
              <label
                >Deck
                <select name="deckId">
                  {#each data.decks as deck (deck.id)}
                    <option value={deck.id} selected={deck.id === data.deck.id}>
                      {deck.name}
                    </option>
                  {/each}
                </select>
              </label>
              <button type="submit">Save changes</button>
            </form>
          </details>
          {#if note.status === 'approved'}
            <form method="POST" action="?/suspension" use:enhance>
              <input type="hidden" name="cardId" value={`card:${note.id}`} />
              <input
                type="hidden"
                name="suspended"
                value={note.suspended ? 'false' : 'true'}
              />
              <button type="submit"
                >{note.suspended ? 'Resume' : 'Suspend'}</button
              >
            </form>
          {/if}
          <form method="POST" action="?/reject" use:enhance>
            <input type="hidden" name="noteId" value={note.id} />
            <button type="submit">Reject note</button>
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
  <label
    >Explanation (optional)
    <input name="explanation" maxlength="1000" />
  </label>
  <label>Tags (comma-separated) <input name="tags" maxlength="1320" /></label>
  <button type="submit">Add note</button>
</form>
<p>
  <a href={`/app/decks/${encodeURIComponent(data.deck.id)}/export`}
    >Export approved notes for Anki</a
  >
  · <a href="/app/decks">All decks</a>
</p>
