<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import ContentReportForm from '../../../../../../lib/components/ContentReportForm.svelte';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Assessment results · Langlo</title></svelte:head>
<h1>Assessment results</h1>
{#if data.results.grammarRetentionEnabled && data.results.items.some((item) => item.outcome === 'correct' && item.rating === null)}
  <p>
    Rate each correct answer to finish this assessment. An answer left unrated
    will not count toward mastery or retention.
  </p>
{/if}
{#if form && 'reported' in form}<p role="status">
    Report saved. The content and your score are unchanged.
  </p>{/if}
<p><a href="/app/reports">Your reports</a></p>
<p>Correct: {data.results.counts.correct}</p>
<p>Incorrect: {data.results.counts.incorrect}</p>
<p>Uncertain: {data.results.counts.uncertain}</p>
<p>Questions not reached: {data.results.notReached}</p>
<p>
  Uncertain includes unresolved evaluation and Not sure. It cannot increase
  independent grammar evidence. This sample does not certify your language
  level.
</p>
<h2>{data.results.foundationLevel} topics to revisit</h2>
{#if data.results.foundationGaps.length}<ul>
    {#each data.results.foundationGaps as skill (skill)}<li>
        <a href={`/app/learn/${data.results.language}/lesson/${skill}`}
          >{skill}</a
        > — practise this foundation
      </li>{/each}
  </ul>{:else}<p>
    No {data.results.foundationLevel} gaps were observed in this sample. Unsampled
    topics remain unknown.
  </p>{/if}
<h2>Your responses</h2>
<ol>
  {#each data.results.items as item (item.questionId)}<li>
      <p>{item.prompt}</p>
      <p>{item.outcome} · {item.evidenceKind}</p>
      <p>Your answer: {item.answer || 'Not sure'}</p>
      <p>Expected answer: {item.expectedAnswer}</p>
      {#if data.results.grammarRetentionEnabled && item.outcome === 'correct'}
        {#if item.rating}
          <p>You rated this {item.rating}.</p>
        {:else}
          <form method="POST" action="?/rate">
            <input type="hidden" name="attemptId" value={item.attemptId} />
            <fieldset>
              <legend>How difficult was it to recall this answer?</legend>
              <button type="submit" name="rating" value="hard">Hard</button>
              <button type="submit" name="rating" value="good">Good</button>
              <button type="submit" name="rating" value="easy">Easy</button>
            </fieldset>
          </form>
          <form method="POST" action="?/discard">
            <input type="hidden" name="attemptId" value={item.attemptId} />
            <button type="submit">Discard this answer and answer again</button>
          </form>
        {/if}
      {/if}
      <ContentReportForm
        contentVersionId={item.contentVersionId}
        questionId={item.questionId}
        submissionKey={data.reportKeys[item.questionId]}
      />
    </li>{/each}
</ol>
<p><a href="/app">Back to home</a></p>
