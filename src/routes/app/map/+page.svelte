<script lang="ts">
  import type { PageData } from './$types';
  import GrammarProgress from '../../../lib/components/GrammarProgress.svelte';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Grammar skill map · Langlo</title></svelte:head>
<h1>Grammar skill map</h1>
<GrammarProgress tracks={data.tracks} />
