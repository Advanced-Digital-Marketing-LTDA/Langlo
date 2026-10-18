<script lang="ts">
  import { languageNames as names } from '../../../lib/languageNames';
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let chosen = $state('');
  const available = $derived(
    data.languages.filter((language) => !data.enrolled.includes(language))
  );
</script>

<svelte:head>
  <title>Enroll in a track · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Enroll in a track</h1>
{#if form?.message}<p class="error-box" role="alert">{form.message}</p>{/if}
{#if available.length}
  <form method="POST" action="?/enroll" use:enhance>
    <p>
      <label
        >Track
        <select name="language" required bind:value={chosen}>
          {#each available as language (language)}
            <option value={language}>{names[language]}</option>
          {/each}
        </select>
      </label>
    </p>
    <p>
      <label
        >Starting level
        <select name="startingLevel" required>
          {#each data.levels[chosen || available[0]] ?? [] as level (level)}
            <option value={level}>{level}</option>
          {/each}
        </select>
      </label>
    </p>
    <p>
      <label
        >Lesson language
        <select name="explanationLanguage" required>
          {#each data.explanationLanguages as language (language)}
            <option value={language}>{names[language]}</option>
          {/each}
        </select>
      </label>
    </p>
    <button type="submit">Enroll</button>
  </form>
{:else}
  <p>You are enrolled in every available track.</p>
{/if}
<p><a href="/app">Back to home</a></p>
