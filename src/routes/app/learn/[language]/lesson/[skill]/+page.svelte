<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
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
