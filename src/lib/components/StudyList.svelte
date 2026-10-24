<script lang="ts">
  import type { StreamingTrackProgress } from '../server/progress';
  import { masteryLabels, masterySymbols } from '../dashboard';
  import { rankStudyList } from '../skill-map';

  const pageSize = 10;

  let {
    skills,
    language,
    submissionKey,
    returnTo
  }: {
    skills: Awaited<StreamingTrackProgress['progress']>['skills'];
    language: string;
    submissionKey: string;
    returnTo: string;
  } = $props();

  let shownCount = $state(pageSize);
  const ranked = $derived(rankStudyList(skills));
</script>

<section class="study-list" aria-labelledby="study-list-heading">
  <h3 id="study-list-heading">Recommended study list</h3>
  <ol>
    {#each ranked.slice(0, shownCount) as { skill, foundationFor } (skill.skillId)}
      <li>
        <span class="study-level">{skill.level}</span>
        <strong>{skill.title}</strong>
        <span>{masterySymbols[skill.status]} {masteryLabels[skill.status]}</span
        >
        <span
          >{foundationFor
            ? `Foundation for ${foundationFor.title}`
            : `${masteryLabels[skill.status]} · practised ${skill.practisedSessions} ${skill.practisedSessions === 1 ? 'time' : 'times'}`}</span
        >
        <form method="POST" action="?/practise">
          <input type="hidden" name="language" value={language} />
          <input type="hidden" name="skillId" value={skill.skillId} />
          <input type="hidden" name="submissionKey" value={submissionKey} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button type="submit">Practise this topic</button>
        </form>
      </li>
    {/each}
  </ol>
  {#if shownCount < ranked.length}
    <button
      type="button"
      class="view-more"
      onclick={() => (shownCount += pageSize)}>View more</button
    >
  {/if}
</section>

<style>
  .study-list {
    margin-block: 1rem;
  }
  ol {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    gap: 0.25rem;
    padding: 0.75rem;
    border: 1px solid #b8c6d8;
    border-radius: 0.5rem;
    background: #fff;
  }
  .study-level {
    font-size: 0.85rem;
  }
  button {
    min-height: 44px;
    cursor: pointer;
  }
  .view-more {
    margin-top: 0.75rem;
  }
</style>
