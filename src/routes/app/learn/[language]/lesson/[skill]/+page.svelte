<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import Exercise from '../../../../../../lib/components/exercises/Exercise.svelte';
  import ContentReportForm from '../../../../../../lib/components/ContentReportForm.svelte';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const failure = $derived(
    form && 'message' in form ? form.message : undefined
  );
  const recorded = $derived(form !== null && 'recorded' in form);
</script>

<svelte:head>
  <title>{data.lesson ? data.lesson.title : 'Lesson'} · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

{#if data.unavailable}
  <h1>Lesson temporarily unavailable</h1>
  <p class="callout" role="status">
    This lesson is being corrected and cannot be shown right now. Your progress
    is unchanged.
  </p>
{:else if data.lesson}
  <h1>{data.lesson.title}</h1>
  {#if form && 'reportError' in form}<p role="alert">{form.reportError}</p>{/if}
  {#if form && 'reported' in form}<p role="status">
      Report saved. The content and your score are unchanged.
    </p>{/if}
  <p><a href="/app/reports">Your reports</a></p>

  {#if data.lesson.englishFallback}
    <p class="callout" role="status">
      This lesson is only available in English for now. Your explanation
      language setting is unchanged.
    </p>
  {/if}

  <p>{data.lesson.explanation}</p>

  {#if data.lesson.examples.length > 0}
    <h2>Examples</h2>
    <ul>
      {#each data.lesson.examples as example, index (index)}
        <li>
          {#each Object.entries(example) as [code, sentence] (code)}
            <span class="sentence" lang={code}>{sentence}</span>
          {/each}
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.lesson.references.length > 0}
    <h2>References</h2>
    <ul>
      {#each data.lesson.references as reference (reference)}
        <li>{reference}</li>
      {/each}
    </ul>
  {/if}

  {#if data.exercise}
    <h2>Practice</h2>
    {#if data.feedback}
      <section
        aria-label="Practice feedback"
        aria-live="polite"
        class="callout"
      >
        <h3>
          {data.feedback.outcome === 'correct'
            ? 'Correct'
            : data.feedback.outcome === 'incorrect'
              ? 'Incorrect'
              : 'Uncertain'}
        </h3>
        <p>
          {data.feedback.notSure
            ? 'You chose Not sure.'
            : `Your answer: ${data.feedback.answer}`}
        </p>
        {#if data.feedback.expectedAnswer}<p>
            Expected answer: {data.feedback.expectedAnswer}
          </p>{/if}
        {#if data.feedback.outcome === 'uncertain'}<p>
            This answer is uncertain and cannot increase independent grammar
            evidence.
          </p>{/if}
        <p>
          {data.feedback.evidenceKind === 'assisted'
            ? 'Assisted retry — this does not add independent grammar evidence.'
            : 'First response in this session.'}
        </p>
        <ContentReportForm
          contentVersionId={data.feedback.contentVersionId}
          questionId={data.feedback.questionId}
          submissionKey={data.feedback.reportSubmissionKey}
          actionUrl={`?/report&session=${encodeURIComponent(data.exercise.studySessionId)}`}
        />
        {#if data.feedback.retryQuestion}
          <details>
            <summary>Try this question again (assisted)</summary>
            <Exercise
              question={data.feedback.retryQuestion}
              language={data.language}
              studySessionId={data.exercise.studySessionId}
              submissionKey={data.feedback.submissionKey}
              retryAttemptId={data.feedback.attemptId}
              submitLabel="Submit assisted retry"
              {failure}
            />
          </details>
        {/if}
      </section>
    {/if}
    {#if data.exercise.notice}
      <p class="callout" role="status">{data.exercise.notice}</p>
    {:else if data.exercise.question}
      {#if recorded}
        <p class="callout" role="status">Answer recorded.</p>
      {/if}
      <p>
        Question {(data.exercise.answered ?? 0) + 1} of {data.exercise.total}
      </p>
      {#key data.exercise.question.id}
        <Exercise
          question={data.exercise.question}
          language={data.language}
          studySessionId={data.exercise.studySessionId}
          submissionKey={data.exercise.submissionKey}
          {failure}
        />
      {/key}
    {:else}
      <p class="callout" role="status">
        You have answered every question for this skill in this session.
      </p>
    {/if}
  {/if}
  {#if data.reportSubmissionKey}
    <ContentReportForm
      contentVersionId={data.lesson.contentVersionId}
      questionId={data.exercise?.question?.id ?? null}
      submissionKey={data.reportSubmissionKey}
      actionUrl={data.exercise
        ? `?/report&session=${encodeURIComponent(data.exercise.studySessionId)}`
        : '?/report'}
    />
  {/if}
{/if}

<style>
  .callout {
    border: 2px solid currentColor;
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
  }

  .sentence {
    display: block;
  }
</style>
