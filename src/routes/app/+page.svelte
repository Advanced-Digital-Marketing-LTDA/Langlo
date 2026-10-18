<script lang="ts">
  import { navigating } from '$app/state';
  import type { PageData } from './$types';
  import TrackCard from '../../lib/components/dashboard/TrackCard.svelte';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Welcome back, {data.user.name}</h1>
<p>
  Signed in as {data.user.name}. This account is part of the private Langlo
  pilot.
</p>

{#if navigating.to}
  <div class="panel" aria-busy="true" aria-label="Loading dashboard">
    <div class="skel"></div>
    <div class="skel"></div>
    <div class="skel short"></div>
  </div>
{:else if !data.tracks.length}
  <section class="panel" aria-labelledby="first-run">
    <h2 id="first-run">Start with the grammar assessment</h2>
    <p>
      No grammar history is available yet. Your skill map, mastery and
      recommended topics appear here once you begin.
    </p>
    <a href="/app/assessment">Grammar assessment</a> ·
    <a href="/app/enroll">Enroll in a track</a>
  </section>
{:else}
  {#each data.tracks as track (track.language)}
    <TrackCard {track} />
  {/each}
  <p class="note">
    Grammar evidence is separate from flashcard recall.
    <a href="/app/assessment">Grammar assessment</a> ·
    <a href="/app/reports">Your reports</a> ·
    <a href="/app/enroll">Enroll in a track</a>
  </p>
{/if}

<form method="POST" action="?/signOut">
  <button type="submit">Sign out</button>
</form>

<style>
  .panel {
    padding: 1.25rem;
    background: white;
    border: 1px solid #d9e2ef;
    border-radius: 0.8rem;
    margin-bottom: 1.25rem;
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
  .note {
    color: #49617a;
    font-size: 0.9rem;
  }
  button {
    min-height: 44px;
    padding: 0.4rem 1.1rem;
    border: 1px solid #b8c6d8;
    border-radius: 0.6rem;
    background: white;
    font-weight: 600;
    cursor: pointer;
  }
</style>
