<script lang="ts">
  import { languageNames as names } from '../../../lib/languageNames';
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>Settings · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Settings</h1>
{#if form?.message}<p class="error-box" role="alert">{form.message}</p>{/if}
{#if form?.saved}<p role="status">{form.saved}</p>{/if}

<h2>Lesson language</h2>
{#each data.enrollments as enrollment (enrollment.language)}
  <form method="POST" action="?/explanationLanguage" use:enhance>
    <input type="hidden" name="language" value={enrollment.language} />
    <label
      >{names[enrollment.language]} explanations
      <select name="explanationLanguage">
        {#each data.explanationLanguages as language (language)}
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

<h2>Timezone</h2>
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
