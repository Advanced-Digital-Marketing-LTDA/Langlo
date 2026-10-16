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
    failure = undefined
  }: {
    question: ExerciseQuestion;
    language: string;
    studySessionId: string;
    submissionKey: string;
    failure?: string | undefined;
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
  const fieldId = $derived(`answer-${question.id}`);

  // A quick local message; the server checks the same rules and decides.
  function isAnswerable() {
    const checked = checkAnswer(
      question.format,
      value,
      question.alternatives ?? []
    );
    problem = checked.ok ? '' : checked.message;
    return checked.ok;
  }
</script>

<form
  method="POST"
  action={answerActionUrl(studySessionId)}
  novalidate
  use:enhance={({ cancel }) => {
    // use:enhance sends the form itself, so a refused answer is cancelled here.
    if (!isAnswerable()) return cancel();
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

  <fieldset>
    <legend>{instructions[question.format]}</legend>
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
        bind:value
        describedby={message ? 'exercise-problem' : undefined}
      />
    {:else}
      <TextAnswer
        id={fieldId}
        name="answer"
        label="Your answer"
        {language}
        multiline={question.format !== 'typed-blank'}
        bind:value
        describedby={message ? 'exercise-problem' : undefined}
      />
    {/if}
  </fieldset>

  {#if message}
    <p id="exercise-problem" class="problem" role="alert">{message}</p>
  {/if}

  <button type="submit" disabled={pending}>Submit answer</button>
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
