<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Grammar assessment · Langlo</title></svelte:head>
<h1>Choose an assessment</h1>
<p>Assess grammar in an enrolled track. Results appear after you finish.</p>
{#if data.saved.length}<h2>Continue an assessment</h2>
  <ul>
    {#each data.saved as session (session.id)}<li>
        <a href={`/app/assessment/session/${encodeURIComponent(session.id)}`}
          >{session.language.toUpperCase()} — {session.state}</a
        >
      </li>{/each}
  </ul>{/if}
{#if data.tracks.length}<ul>
    {#each data.tracks as track (track.language)}<li>
        <a href={`/app/assessment/${track.language}`}
          >{track.language.toUpperCase()} {track.level}</a
        >
      </li>{/each}
  </ul>{:else}<p>You have no enrolled tracks yet.</p>{/if}
<a href="/app">Back to home</a>
