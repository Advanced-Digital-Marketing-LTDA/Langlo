<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import Exercise from '../../../../../lib/components/exercises/Exercise.svelte';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Grammar assessment · Langlo</title></svelte:head>
<h1>Grammar assessment</h1>
<p>
  Results and feedback appear after completion. This sample includes {data
    .assessment.coverage.A1} A1 and {data.assessment.coverage.A2} A2 topics.
</p>
{#if data.assessment.state === 'paused'}
  <p>This assessment is paused. Your answers are saved.</p>
  <form method="POST" action="?/resume">
    <button type="submit">Resume assessment</button>
  </form>
{:else if data.assessment.question}
  <p>Question {data.assessment.answered + 1} of {data.assessment.total}</p>
  {#key data.assessment.question.id}<Exercise
      question={data.assessment.question}
      language={data.assessment.language}
      studySessionId={data.assessment.id}
      submissionKey={data.submissionKey}
      actionUrl="?/answer"
      failure={form && 'message' in form ? form.message : undefined}
    />{/key}
{/if}
<p><a href="/app">Leave and return later</a></p>
