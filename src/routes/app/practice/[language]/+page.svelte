<script lang="ts">
  import type { PageData } from './$types';
  import Chip from '../../../../lib/prototype/Chip.svelte';
  import { masteryLabels, masterySymbols } from '../../../../lib/dashboard';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Practice · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Practise {data.language.toUpperCase()} grammar</h1>
<p>
  A practice session groups your answers so you can pause, resume and review
  them. Practice answers never replace an assessment.
</p>
<form method="POST" action="?/start">
  <input type="hidden" name="submissionKey" value={data.submissionKey} />
  <button type="submit">Start practice</button>
</form>
{#if data.error}
  <p class="error-box" role="alert">{data.error}</p>
{:else}
  <section aria-label="Recommended practice">
    <h2>Recommended practice</h2>
    {#if data.recommendations.length}
      <ul class="topics">
        {#each data.recommendations as recommendation (recommendation.skillId)}
          {@const skill = data.skills.find(
            (item) => item.skillId === recommendation.skillId
          )}
          {#if skill}
            <li>
              <h3>{skill.title}</h3>
              <Chip
                variant="mastery"
                label={masteryLabels[recommendation.status]}
                symbol={masterySymbols[recommendation.status]}
              />
              <p>
                Practised {recommendation.practisedSessions}
                {recommendation.practisedSessions === 1 ? ' time' : ' times'} ·
                {recommendation.answers}
                {recommendation.answers === 1 ? ' answer' : ' answers'}
              </p>
              <p>{recommendation.reason}</p>
              <p>
                <a href={`/app/learn/${data.language}/lesson/${skill.skillId}`}
                  >Open {skill.title}</a
                >
              </p>
            </li>
          {/if}
        {/each}
      </ul>
    {:else}
      <p>No started topics need work yet</p>
    {/if}
  </section>
  <section aria-label="All topics">
    <h2>All topics</h2>
    {#if data.skills.length}
      <ul class="topics">
        {#each data.skills as skill (skill.skillId)}
          <li id={`topic-${skill.skillId}`}>
            <h3>{skill.title}</h3>
            <Chip
              variant="mastery"
              label={masteryLabels[skill.status]}
              symbol={masterySymbols[skill.status]}
            />
            <p>
              {skill.answers > 0
                ? `Practised ${skill.practisedSessions} ${skill.practisedSessions === 1 ? 'time' : 'times'} · ${skill.answers} ${skill.answers === 1 ? 'answer' : 'answers'}`
                : 'Not practised yet'}
            </p>
            {#if skill.available}
              <p>
                <a href={`/app/learn/${data.language}/lesson/${skill.skillId}`}
                  >Open {skill.title}</a
                >
              </p>
            {:else}
              <p>Lesson temporarily unavailable or not published yet.</p>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p>No published skills are available in this track yet.</p>
    {/if}
  </section>
{/if}
<p><a href="/app">Back to home</a></p>

<style>
  .topics {
    display: grid;
    gap: 1rem;
    list-style: none;
    padding: 0;
  }
  .topics > li {
    padding: 1rem;
    border: 1px solid #b8c6d8;
    border-radius: 0.5rem;
    overflow-wrap: anywhere;
  }
  h3 {
    margin: 0 0 0.5rem;
  }
</style>
