<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import Chip from '../../../../lib/prototype/Chip.svelte';
  import { masteryLabels, masterySymbols } from '../../../../lib/dashboard';
  let { data, form }: { data: PageData; form: ActionData } = $props();
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
  <button type="submit"
    >{data.unfinished ? 'Continue practice' : 'Start practice'}</button
  >
</form>
{#if data.unfinished}
  <p>
    {data.unfinished.answered}
    {data.unfinished.answered === 1 ? 'answer' : 'answers'} so far in your unfinished
    practice.
  </p>
  <details>
    <summary>Start over</summary>
    <p>
      This finishes your current practice and begins a new one. Answers you
      rated or got wrong stay in your history; correct answers you have not
      rated yet are not kept.
    </p>
    <form method="POST" action="?/startOver">
      <input type="hidden" name="submissionKey" value={data.submissionKey} />
      <button type="submit">Yes, start over</button>
    </form>
  </details>
{/if}
{#if form && 'message' in form}<p role="alert">{form.message}</p>{/if}
{#if data.error}
  <p class="error-box" role="alert">{data.error}</p>
{:else}
  <section aria-label="Due grammar reviews">
    <h2>Due grammar reviews</h2>
    <p>
      Each review covers one question per topic, with up to five topics in a
      session. Choose which due topics to include.
    </p>
    {#if data.dueReviews.length}
      <form method="POST" action="?/review">
        <input type="hidden" name="submissionKey" value={data.submissionKey} />
        <fieldset>
          <legend>Select due topics</legend>
          {#each data.dueReviews as review (review.skillId)}
            <label>
              <input
                type="checkbox"
                name="skillId"
                value={review.skillId}
                checked
              />
              {review.title}
            </label>
          {/each}
        </fieldset>
        <button type="submit">Review selected topics</button>
      </form>
    {:else}
      <p>No grammar skills are due right now.</p>
    {/if}
  </section>
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
