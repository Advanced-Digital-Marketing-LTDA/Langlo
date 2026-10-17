<script lang="ts">
  import { enhance } from '$app/forms';
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
    submitLabel = 'Submit answer'
  }: {
    question: ExerciseQuestion;
    language: string;
    studySessionId: string;
    submissionKey: string;
    failure?: string | undefined;
    actionUrl?: string | undefined;
    retryAttemptId?: string | undefined;
    submitLabel?: string;
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
  const message = $derived(problem || failure || '');
  const legendId = $derived(`instruction-${question.id}`);
  const fieldId = $derived(`answer-${question.id}`);
  const problemId = $derived(`exercise-problem-${question.id}`);
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
    return async ({ result, update }) => {
      // Keep what was typed when the server refused it.
      await update({ reset: result.type === 'success' });
      if (result.type === 'success') value = '';
      pending = false;
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

  <button type="submit" disabled={pending}>{submitLabel}</button>
  <button type="submit" name="intent" value="unsure" disabled={pending}
    >Not sure</button
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
