<script lang="ts">
  import { enhance } from '$app/forms';
  import { getContext, onDestroy } from 'svelte';
  import { hydration } from '../../hydration.svelte';
  import {
    answerActionUrl,
    checkAnswer,
    type ExerciseFormat,
    type ExerciseQuestion
  } from './answer';
  import MultipleChoice from './MultipleChoice.svelte';
  import TextAnswer from './TextAnswer.svelte';

  let {
    question,
    language,
    studySessionId,
    submissionKey,
    failure = undefined,
    actionUrl = undefined,
    retryAttemptId = undefined,
    submitLabel = 'Submit answer',
    onanswered = undefined
  }: {
    question: ExerciseQuestion;
    language: string;
    studySessionId: string;
    submissionKey: string;
    failure?: string | undefined;
    actionUrl?: string | undefined;
    retryAttemptId?: string | undefined;
    submitLabel?: string;
    /** Runs after an accepted answer has updated the page. */
    onanswered?: (() => Promise<void>) | undefined;
  } = $props();

  const instructions: Record<ExerciseFormat, string> = {
    'multiple-choice': 'Choose the correct answer.',
    'typed-blank': 'Type the missing word or words.',
    translation: 'Translate the sentence.',
    correction: 'Rewrite the sentence with the mistake corrected.'
  };

  let value = $state('');
  let problem = $state('');
  let pending = $state(false);
  let failed = $state(false);
  let unreachable = $state(false);
  let refreshBlocked = false;
  const setRefreshBlocked = getContext<(blocked: boolean) => void>(
    'app-version-refresh-blocked'
  );
  const message = $derived(
    problem ||
      failure ||
      (unreachable
        ? 'Could not reach the server. Your answer was not saved. Try again.'
        : '')
  );
  const legendId = $derived(`instruction-${question.id}`);
  const fieldId = $derived(`answer-${question.id}`);
  const problemId = $derived(`exercise-problem-${question.id}`);

  $effect(() => {
    const blocked = value !== '' || pending || failed;
    if (blocked !== refreshBlocked) {
      refreshBlocked = blocked;
      setRefreshBlocked(blocked);
    }
  });

  onDestroy(() => {
    if (refreshBlocked) setRefreshBlocked(false);
  });
</script>

<form
  method="POST"
  action={actionUrl ?? answerActionUrl(studySessionId)}
  novalidate
  use:enhance={({ cancel, submitter }) => {
    // Enhanced submissions must be cancelled through enhance itself.
    const checked = checkAnswer(
      question.format,
      value,
      question.alternatives ?? []
    );
    const unsure = submitter?.getAttribute('value') === 'unsure';
    problem = unsure || checked.ok ? '' : checked.message;
    if (!unsure && !checked.ok) {
      cancel();
      return;
    }
    pending = true;
    unreachable = false;
    // This component is replaced once the next question arrives, so the
    // callback is read now rather than from props afterwards.
    const answered = onanswered;
    return async ({ result, update }) => {
      // The request never produced an action result (offline, or the server
      // is restarting): keep the page and what was typed, so it can be sent
      // again with the same submission key.
      if (result.type === 'error' && result.status === undefined) {
        unreachable = true;
        failed = true;
        pending = false;
        return;
      }
      // Keep what was typed when the server refused it.
      await update({ reset: result.type === 'success' });
      if (result.type === 'success') value = '';
      failed = result.type === 'failure';
      pending = false;
      if (result.type === 'success') await answered?.();
    };
  }}
>
  <input type="hidden" name="studySessionId" value={studySessionId} />
  <input type="hidden" name="questionId" value={question.id} />
  <input type="hidden" name="submissionKey" value={submissionKey} />
  {#if retryAttemptId}<input
      type="hidden"
      name="retryAttemptId"
      value={retryAttemptId}
    />{/if}

  <fieldset>
    <legend id={legendId}>{instructions[question.format]}</legend>
    <p
      class="prompt"
      lang={question.format === 'translation' ? undefined : language}
    >
      {question.prompt}
    </p>

    {#if question.format === 'multiple-choice'}
      <MultipleChoice
        name="answer"
        options={question.alternatives ?? []}
        labelledby={legendId}
        bind:value
        describedby={message ? problemId : undefined}
      />
    {:else}
      <TextAnswer
        id={fieldId}
        name="answer"
        label="Your answer"
        {language}
        multiline={question.format !== 'typed-blank'}
        bind:value
        describedby={message ? problemId : undefined}
      />
    {/if}
  </fieldset>

  {#if message}
    <p id={problemId} class="problem" role="alert">{message}</p>
  {/if}

  <button type="submit" disabled={pending || !hydration.ready}
    >{submitLabel}</button
  >
  <button
    type="submit"
    name="intent"
    value="unsure"
    disabled={pending || !hydration.ready}>Not sure</button
  >
</form>

<style>
  form {
    display: grid;
    gap: 1rem;
  }

  fieldset {
    border: 0;
    display: grid;
    gap: 0.75rem;
    margin: 0;
    min-width: 0;
    padding: 0;
  }

  legend {
    font-weight: 600;
    padding: 0;
  }

  .prompt {
    font-size: 1.25rem;
    margin: 0;
  }

  .problem {
    border: 2px solid currentColor;
    border-radius: 0.5rem;
    margin: 0;
    padding: 0.75rem 1rem;
  }

  button[type='submit'] {
    font: inherit;
    min-height: 3rem;
  }
</style>
