<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import Exercise from '../../../../../../lib/components/exercises/Exercise.svelte';
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
