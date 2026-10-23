<script lang="ts">
  import { languageNames as names } from '../../../lib/languageNames';
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  type Schedule = {
    desiredRetention: number;
    newCardPreset: '10m' | '1m+10m' | '30m';
    relearningPreset: '10m' | '30m' | '1h';
  };
  type ScheduleActionData = {
    message?: string;
    saved?: string;
  };
  const scheduleForm = $derived(form as ScheduleActionData | null);
  let retention = $state(90);
  let newCardPreset = $state<Schedule['newCardPreset']>('1m+10m');
  let relearningPreset = $state<Schedule['relearningPreset']>('10m');
  let initialized = false;
  $effect(() => {
    if (!initialized || scheduleForm?.saved === 'Study schedule saved.') {
      const schedule = data.studySchedule;
      retention = schedule.desiredRetention;
      newCardPreset = schedule.newCardPreset;
      relearningPreset = schedule.relearningPreset;
    }
    initialized = true;
  });
</script>

<svelte:head>
  <title>Settings · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Settings</h1>
{#if scheduleForm?.message}<p class="error-box" role="alert">
    {scheduleForm.message}
  </p>{/if}
{#if scheduleForm?.saved}<p role="status">{scheduleForm.saved}</p>{/if}

<h2>Lesson language</h2>
{#each data.enrollments as enrollment (enrollment.language)}
  <form method="POST" action="?/explanationLanguage" use:enhance>
    <input type="hidden" name="language" value={enrollment.language} />
    <label
      >{names[enrollment.language]} explanations
      <select name="explanationLanguage">
        {#each data.explanationLanguagesByTrack[enrollment.language] ?? [] as language (language)}
          <option
            value={language}
            selected={language === enrollment.explanationLanguage}
            >{names[language]}</option
          >
        {/each}
      </select>
    </label>
    <button type="submit">Save {names[enrollment.language]} language</button>
  </form>
{:else}
  <p>
    You have no enrolled tracks yet. <a href="/app/enroll">Enroll in a track</a
    >.
  </p>
{/each}

<h2>Study schedule</h2>
<p>
  Higher desired retention means shorter intervals and more frequent reviews.
  These settings apply to new cards and the next rating of existing cards.
</p>
<form method="POST" action="?/saveStudySchedule" use:enhance>
  <label
    >Desired retention: {retention}%
    <input
      type="range"
      name="desiredRetention"
      min="70"
      max="97"
      step="1"
      bind:value={retention}
    />
  </label>
  <label
    >New cards
    <select name="newCardPreset" bind:value={newCardPreset}>
      <option value="10m">10m</option>
      <option value="1m+10m">1m + 10m</option>
      <option value="30m">30m</option>
    </select>
  </label>
  <label
    >After forgetting
    <select name="relearningPreset" bind:value={relearningPreset}>
      <option value="10m">10m</option>
      <option value="30m">30m</option>
      <option value="1h">1h</option>
    </select>
  </label>
  <button type="submit">Save study schedule</button>
</form>

<h2>Timezone</h2>
<p>
  Your study day starts at 04:00 in your saved timezone. UTC applies until you
  save one.
</p>
<form method="POST" action="?/timezone" use:enhance>
  <label
    >Timezone (for example Europe/Lisbon)
    <input
      name="timezone"
      value={data.timezone ?? ''}
      required
      maxlength="64"
    />
  </label>
  <button type="submit">Save timezone</button>
</form>
<p><a href="/app">Back to home</a></p>
