<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Practice · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Practise {data.language.toUpperCase()} grammar</h1>
<p>
  A practice session groups your answers so you can pause, resume and review
  them. Practice answers never replace an assessment.
</p>
<form method="POST" action="?/start">
  <input type="hidden" name="submissionKey" value={data.submissionKey} />
  <button type="submit">Start practice</button>
</form>
<p><a href="/app">Back to home</a></p>
