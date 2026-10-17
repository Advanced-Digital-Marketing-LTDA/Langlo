<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import ContentReportForm from '../../../../../../lib/components/ContentReportForm.svelte';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Assessment results · Langlo</title></svelte:head>
<h1>Assessment results</h1>
{#if form && 'reported' in form}<p role="status">
    Report saved. The content and your score are unchanged.
  </p>{/if}
<p><a href="/app/reports">Your reports</a></p>
<p>Correct: {data.results.counts.correct}</p>
<p>Incorrect: {data.results.counts.incorrect}</p>
<p>Uncertain: {data.results.counts.uncertain}</p>
<p>
  Uncertain includes unresolved evaluation and Not sure. It cannot increase
  independent grammar evidence. This sample does not certify your language
  level.
</p>
<h2>A1 topics to revisit</h2>
{#if data.results.a1Gaps.length}<ul>
    {#each data.results.a1Gaps as skill (skill)}<li>
        <a href={`/app/learn/${data.results.language}/lesson/${skill}`}
          >{skill}</a
        > — practise this foundation
      </li>{/each}
  </ul>{:else}<p>
    No A1 gaps were observed in this sample. Unsampled topics remain unknown.
  </p>{/if}
<h2>Your responses</h2>
<ol>
  {#each data.results.items as item (item.questionId)}<li>
      <p>{item.prompt}</p>
      <p>{item.outcome} · {item.evidenceKind}</p>
      <p>Your answer: {item.answer || 'Not sure'}</p>
      <p>Expected answer: {item.expectedAnswer}</p>
      <ContentReportForm
        contentVersionId={item.contentVersionId}
        questionId={item.questionId}
        submissionKey={data.reportKeys[item.questionId]}
      />
    </li>{/each}
</ol>
<p><a href="/app">Back to home</a></p>
