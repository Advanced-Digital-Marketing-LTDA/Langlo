<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import Exercise from '../../../../../lib/components/exercises/Exercise.svelte';
  import StudyTimer from '../../../../../lib/components/StudyTimer.svelte';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Grammar assessment · Langlo</title></svelte:head>
<StudyTimer category="grammar" />
<h1>Grammar assessment</h1>
<p>
  Results and feedback appear after completion. This sample includes {Object.entries(
    data.assessment.coverage
  )
    .map(([level, count]) => `${count} ${level}`)
    .join(' and ')} topics.
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
