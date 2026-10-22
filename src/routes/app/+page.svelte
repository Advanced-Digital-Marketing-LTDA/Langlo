<script lang="ts">
  import { navigating } from '$app/state';
  import type { ActionData, PageData } from './$types';
  import TrackCard from '../../lib/components/dashboard/TrackCard.svelte';
  let { data, form }: { data: PageData; form: ActionData } = $props();
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
    {#if data.unfinished[track.language]}
      {@const unfinished = data.unfinished[track.language]}
      <p class="note">
        <a href={`/app/session/${encodeURIComponent(unfinished.id)}`}
          >Continue practice</a
        >
        · {unfinished.answered}
        {unfinished.answered === 1 ? 'answer' : 'answers'} so far
      </p>
    {/if}
  {/each}
  <p class="note">
    Grammar evidence is separate from flashcard recall.
    <a href="/app/assessment">Grammar assessment</a> ·
    <a href="/app/reports">Your reports</a> ·
    <a href="/app/enroll">Enroll in a track</a>
  </p>
{/if}

{#if !navigating.to && data.reviewDueByDay}
  <section class="panel" aria-labelledby="review-due-title">
    <h2 id="review-due-title">Reviews due by day</h2>
    {#if data.reviewDueByDay.every((day) => day.total === 0)}
      <p>No reviews are due in the next seven study days.</p>
    {/if}
    <div class="review-table-scroll">
      <table aria-label="Grammar and flashcard reviews due each study day">
        <thead>
          <tr>
            <th scope="col">Study day</th>
            <th scope="col">Grammar reviews</th>
            <th scope="col">Flashcards</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {#each data.reviewDueByDay as day (day.date)}
            <tr>
              <th scope="row"><time datetime={day.date}>{day.date}</time></th>
              <td>{day.grammar}</td>
              <td>{day.flashcards}</td>
              <td>{day.total}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}

<form method="POST" action="?/signOut">
  {#if form?.message}<p class="error-box" role="alert">{form.message}</p>{/if}
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
  .review-table-scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
  }
  th,
  td {
    padding: 0.55rem 0.8rem 0.55rem 0;
    border-bottom: 1px solid #d9e2ef;
    white-space: nowrap;
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
