<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Signed in as {data.user.name}</h1>
<p>This account is part of the private Langlo pilot.</p>
<p><a href="/app/assessment">Grammar assessment</a></p>
<nav aria-label="Learning navigation">
  <a href="/app/map">Grammar skill map</a> ·
  <a href="/app/progress">Grammar progress</a>
</nav>
<p><a href="/app/reports">Your reports</a></p>
<h2>Grammar evidence</h2>
{#if !data.tracks.length}<p>No grammar history is available yet.</p>{/if}
{#each data.tracks as track (track.language)}
  <h3>{track.language.toUpperCase()} {track.level}</h3>
  <p>
    {track.skills.filter((skill) => skill.status === 'secure').length} secure topics;
    {track.skills.filter((skill) => skill.status === 'weak').length} weak topics.
    Grammar evidence is separate from flashcard recall.
  </p>
  {#if track.recommendation}<p>
      <a
        href={`/app/learn/${track.language}/lesson/${track.recommendation.skillId}`}
        >Continue {track.skills.find(
          (skill) => skill.skillId === track.recommendation?.skillId
        )?.title}</a
      >
    </p>
    <p>{track.recommendation.reason}</p>{/if}
{/each}

<form method="POST" action="?/signOut">
  <button type="submit">Sign out</button>
</form>
