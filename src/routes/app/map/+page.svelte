<script lang="ts">
  import type { PageData } from './$types';
  import GrammarProgress from '../../../lib/components/GrammarProgress.svelte';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Grammar skill map · Langlo</title></svelte:head>
<h1>Grammar skill map</h1>
{#if data.tracks.length}
  <nav aria-label="Enrolled languages">
    {#each data.tracks as track (track.language)}
      <a href={`#track-${track.language}`}>{track.language.toUpperCase()}</a>
    {/each}
  </nav>
{/if}
<GrammarProgress tracks={data.tracks} />
