<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import type { ActionData, PageData } from './$types';
  import { hydration } from '../../../../../../lib/hydration.svelte';
  import Exercise from '../../../../../../lib/components/exercises/Exercise.svelte';
  import ContentReportForm from '../../../../../../lib/components/ContentReportForm.svelte';
  import StudyTimer from '../../../../../../lib/components/StudyTimer.svelte';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const failure = $derived(
    form && 'message' in form ? form.message : undefined
  );
  const recorded = $derived(form !== null && 'recorded' in form);
  // A rating result carries the next exercise, so the page moves on from it
  // instead of reloading. It is kept until the page data loads again, such as
  // after the answer to that exercise, so a refused answer keeps the exercise
  // and shows its message.
  type Rated = Extract<NonNullable<ActionData>, { rated: true }>;
  let rated = $state<Rated | null>(null);
  $effect.pre(() => {
    void data;
    rated = null;
  });
  $effect.pre(() => {
    if (form?.rated) rated = form;
  });
  const feedback = $derived(
    rated && data.feedback
      ? { ...data.feedback, rating: rated.rating }
      : data.feedback
  );
  const exercise = $derived(rated ? rated.exercise : data.exercise);

  const outcomeLabel = $derived(
    feedback?.outcome === 'correct'
      ? 'Correct'
      : feedback?.outcome === 'incorrect'
        ? 'Incorrect'
        : 'Uncertain'
  );
  // Spoken through a live region that is on the page before the answer, so
  // the result is announced instead of arriving as already-filled markup.
  const announcement = $derived.by(() => {
    if (!feedback) return '';
    if (feedback.rating)
      return `You rated this ${feedback.rating}. The skill schedule updates when you finish the session.`;
    return `${outcomeLabel}. ${feedback.notSure ? 'You chose Not sure.' : `Your answer: ${feedback.answer}`}`;
  });

  let feedbackHeading: HTMLElement | undefined = $state();
  let ratedMessage: HTMLElement | undefined = $state();
  let ratePending = $state(false);
  let rateUnreachable = $state(false);

  // Answering and rating update the page in place, so keyboard and screen
  // reader focus has to follow the new result. This runs after the form's
  // update finishes, which is when SvelteKit has already reset focus.
  async function focusFeedback() {
    await tick();
    focusResult(feedbackHeading, 'feedback heading');
  }

  function focusResult(target: HTMLElement | undefined, name: string) {
    if (!target) throw new Error(`The ${name} is missing after the update.`);
    target.focus();
  }

  function lessonActionUrl(action: 'answer' | 'report') {
    const session = exercise
      ? `&session=${encodeURIComponent(exercise.studySessionId)}`
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
<StudyTimer category="grammar" />

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

  {#if exercise}
    <h2>Practice</h2>
    <div class="visually-hidden" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
    {#if feedback}
      <section aria-label="Practice feedback" class="callout">
        <h3 tabindex="-1" bind:this={feedbackHeading}>{outcomeLabel}</h3>
        <p>
          {feedback.notSure
            ? 'You chose Not sure.'
            : `Your answer: ${feedback.answer}`}
        </p>
        {#if feedback.expectedAnswer}<p>
            Expected answer: {feedback.expectedAnswer}
          </p>{/if}
        {#if feedback.outcome === 'uncertain'}<p>
            This answer is uncertain and cannot increase independent grammar
            evidence.
          </p>{/if}
        <p>
          {feedback.receivedHelp
            ? 'Assisted retry — this does not add independent grammar evidence.'
            : feedback.evidenceKind === 'assisted'
              ? 'Repeated item — it does not add new grammar evidence, but an unassisted rated answer may update retention.'
              : 'First response in this session.'}
        </p>
        {#if feedback.requiresRating && !feedback.receivedHelp && feedback.outcome === 'correct'}
          {#if feedback.rating}
            <p role="status" tabindex="-1" bind:this={ratedMessage}>
              You rated this {feedback.rating}. The skill schedule updates when
              you finish the session.
            </p>
          {:else}
            <form
              method="POST"
              action={`?/rate&session=${encodeURIComponent(exercise.studySessionId)}`}
              use:enhance={() => {
                ratePending = true;
                rateUnreachable = false;
                return async ({ result, update }) => {
                  // No action result at all: keep the buttons so the rating
                  // can be sent again.
                  if (result.type === 'error' && result.status === undefined) {
                    rateUnreachable = true;
                    ratePending = false;
                    return;
                  }
                  try {
                    await update({ invalidateAll: false });
                  } finally {
                    ratePending = false;
                  }
                  if (result.type === 'success') {
                    await tick();
                    focusResult(ratedMessage, 'rating message');
                  }
                };
              }}
            >
              <input
                type="hidden"
                name="studySessionId"
                value={exercise.studySessionId}
              />
              <input
                type="hidden"
                name="attemptId"
                value={feedback.attemptId}
              />
              <fieldset>
                <legend>How difficult was it to recall the answer?</legend>
                <button
                  type="submit"
                  name="rating"
                  value="hard"
                  disabled={ratePending || !hydration.ready}>Hard</button
                >
                <button
                  type="submit"
                  name="rating"
                  value="good"
                  disabled={ratePending || !hydration.ready}>Good</button
                >
                <button
                  type="submit"
                  name="rating"
                  value="easy"
                  disabled={ratePending || !hydration.ready}>Easy</button
                >
              </fieldset>
              {#if rateUnreachable}
                <p role="alert">
                  Could not confirm the server received your rating. Try again.
                </p>
              {/if}
            </form>
          {/if}
        {:else if !feedback.receivedHelp && feedback.outcome === 'incorrect'}
          <p role="status">
            This counts as Again for the skill schedule when you finish the
            session.
          </p>
        {/if}
        <ContentReportForm
          contentVersionId={feedback.contentVersionId}
          questionId={feedback.questionId}
          submissionKey={feedback.reportSubmissionKey}
          actionUrl={lessonActionUrl('report')}
        />
        {#if feedback.retryQuestion}
          <details>
            <summary>Try this question again (assisted)</summary>
            <Exercise
              question={feedback.retryQuestion}
              language={data.language}
              studySessionId={exercise.studySessionId}
              submissionKey={feedback.submissionKey}
              retryAttemptId={feedback.attemptId}
              actionUrl={lessonActionUrl('answer')}
              onanswered={focusFeedback}
              submitLabel="Submit assisted retry"
              {failure}
            />
          </details>
        {/if}
      </section>
    {/if}
    {#if exercise.notice}
      <p class="callout" role="status">{exercise.notice}</p>
    {:else if exercise.question}
      {#if recorded}
        <p class="callout" role="status">Answer recorded.</p>
      {/if}
      <p>
        Question {(exercise.answered ?? 0) + 1} of {exercise.total}
      </p>
      {#key exercise.question.id}
        <Exercise
          question={exercise.question}
          language={data.language}
          studySessionId={exercise.studySessionId}
          submissionKey={exercise.submissionKey}
          actionUrl={lessonActionUrl('answer')}
          onanswered={focusFeedback}
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
      questionId={exercise?.question?.id ?? null}
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

  .visually-hidden {
    border: 0;
    clip-path: inset(50%);
    height: 1px;
    margin: -1px;
    overflow: hidden;
    padding: 0;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
</style>
