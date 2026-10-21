<script lang="ts">
  import { page } from '$app/state';
  import type { ActionData, PageData } from './$types';
  import Exercise from '../../../../../../lib/components/exercises/Exercise.svelte';
  import ContentReportForm from '../../../../../../lib/components/ContentReportForm.svelte';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const failure = $derived(
    form && 'message' in form ? form.message : undefined
  );
  const recorded = $derived(form !== null && 'recorded' in form);

  function lessonActionUrl(action: 'answer' | 'report') {
    const session = data.exercise
      ? `&session=${encodeURIComponent(data.exercise.studySessionId)}`
      : '';
    const returnTo = page.url.searchParams.has('returnTo')
      ? `&returnTo=${encodeURIComponent(data.returnTo)}`
      : '';
    return `?/${action}${session}${returnTo}`;
  }
</script>

<svelte:head>
  <title>{data.lesson ? data.lesson.title : 'Lesson'} · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<p><a href={data.returnTo}>Back to skill map</a></p>
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

  {#if data.lesson.newerVersionAvailable}
    <p class="callout" role="status">
      This lesson was updated. You are finishing the version you started; your
      next session uses the new one.
    </p>
  {/if}

  {#if data.lesson.englishOnlyTrack}
    <p class="callout" role="status">
      The lessons in this course are written in English.
    </p>
  {/if}

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
          {data.feedback.receivedHelp
            ? 'Assisted retry — this does not add independent grammar evidence.'
            : data.feedback.evidenceKind === 'assisted'
              ? 'Repeated item — it does not add new grammar evidence, but an unassisted rated answer may update retention.'
              : 'First response in this session.'}
        </p>
        {#if data.feedback.requiresRating && !data.feedback.receivedHelp && data.feedback.outcome === 'correct'}
          {#if data.feedback.rating}
            <p role="status">
              You rated this {data.feedback.rating}. The skill schedule updates
              when you finish the session.
            </p>
          {:else}
            <form
              method="POST"
              action={`?/rate&session=${encodeURIComponent(data.exercise.studySessionId)}`}
            >
              <input
                type="hidden"
                name="studySessionId"
                value={data.exercise.studySessionId}
              />
              <input
                type="hidden"
                name="attemptId"
                value={data.feedback.attemptId}
              />
              <fieldset>
                <legend>How difficult was it to recall the answer?</legend>
                <button type="submit" name="rating" value="hard">Hard</button>
                <button type="submit" name="rating" value="good">Good</button>
                <button type="submit" name="rating" value="easy">Easy</button>
              </fieldset>
            </form>
          {/if}
        {:else if !data.feedback.receivedHelp && data.feedback.outcome === 'incorrect'}
          <p role="status">
            This counts as Again for the skill schedule when you finish the
            session.
          </p>
        {/if}
        <ContentReportForm
          contentVersionId={data.feedback.contentVersionId}
          questionId={data.feedback.questionId}
          submissionKey={data.feedback.reportSubmissionKey}
          actionUrl={lessonActionUrl('report')}
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
              actionUrl={lessonActionUrl('answer')}
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
          actionUrl={lessonActionUrl('answer')}
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
      actionUrl={lessonActionUrl('report')}
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
