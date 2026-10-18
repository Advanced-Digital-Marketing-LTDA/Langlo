<script lang="ts">
  import type { TrackProgress } from '../../server/progress';
  import Chip from '../../prototype/Chip.svelte';
  import {
    masteryLabels,
    masterySymbols,
    summarizeTrack
  } from '../../dashboard';
  let { track }: { track: TrackProgress } = $props();
  const summary = $derived(summarizeTrack(track));
  const statuses = ['secure', 'practising', 'weak', 'unknown'] as const;
</script>

<section class="panel" aria-label={`${track.language.toUpperCase()} dashboard`}>
  <h2>{track.language.toUpperCase()} · starting level {track.level}</h2>

  {#if summary.recommended}
    <div class="continue">
      <p class="eyebrow">Continue</p>
      <h3>{summary.recommended.skill.title}</h3>
      <p class="hint">{summary.recommended.reason}</p>
      <a
        class="button"
        href={`/app/learn/${track.language}/lesson/${summary.recommended.skill.skillId}`}
        >Open lesson</a
      >
    </div>
  {/if}

  {#if !summary.skills.length}
    <p>No published skills are available in this track yet.</p>
  {:else}
    <h3>Grammar mastery</h3>
    <p class="note">From exercise evidence — separate from flashcard recall.</p>
    <ul class="counts">
      {#each statuses as status (status)}
        <li>
          <Chip
            variant="mastery"
            symbol={masterySymbols[status]}
            label={masteryLabels[status]}
          />
          <strong>{summary.counts[status]}</strong>
          <span class="note">of {summary.total} topics</span>
        </li>
      {/each}
    </ul>
    <ul class="skills">
      {#each summary.skills as skill (skill.skillId)}
        <li>
          <a href={`/app/map#${skill.skillId}`}>{skill.title}</a>
          <Chip
            variant="mastery"
            symbol={masterySymbols[skill.status]}
            label={masteryLabels[skill.status]}
          />
        </li>
      {/each}
    </ul>
    <p>
      <a href="/app/map">Full skill map</a> ·
      <a href={`/app/progress?language=${track.language}`}>Progress details</a>
    </p>
  {/if}
</section>

<style>
  .panel {
    padding: 1.25rem;
    background: white;
    border: 1px solid #d9e2ef;
    border-radius: 0.8rem;
    margin-bottom: 1.25rem;
  }
  .continue {
    padding: 1rem;
    margin-bottom: 1rem;
    border: 1px solid #b8c6d8;
    border-radius: 0.6rem;
    background: #eef4fb;
  }
  .continue h3 {
    margin: 0.2rem 0 0.5rem;
  }
  .eyebrow {
    margin: 0;
    color: #49617a;
    font-weight: 650;
  }
  .hint {
    color: #5d4a12;
    background: #fbf3dd;
    border: 1px solid #e4cf9a;
    border-radius: 0.5rem;
    padding: 0.5rem 0.8rem;
  }
  .button {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0.4rem 1.1rem;
    background: #1b5982;
    color: white;
    border-radius: 0.6rem;
    text-decoration: none;
    font-weight: 650;
  }
  .note {
    color: #49617a;
    font-size: 0.85rem;
  }
  .counts,
  .skills {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
  }
  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem 1.5rem;
  }
  .counts li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .skills {
    display: grid;
    gap: 0 1.5rem;
    grid-template-columns: 1fr;
  }
  @media (min-width: 720px) {
    .skills {
      grid-template-columns: 1fr 1fr;
    }
  }
  .skills li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.8rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid #edf1f7;
    overflow-wrap: anywhere;
  }
</style>
