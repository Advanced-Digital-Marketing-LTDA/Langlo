<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Start assessment · Langlo</title></svelte:head>
<h1>Assess {data.language.toUpperCase()} {data.level} grammar</h1>
<p>
  Answer up to 12 unseen questions. For an A2 track, this includes A1
  foundations when available.
</p>
<p>
  Results and expected answers stay hidden until you finish. Choose Not sure
  whenever you need to. This small sample is guidance for practice, not a CEFR
  qualification or a complete assessment of your level.
</p>
<form method="POST" action="?/start">
  <input type="hidden" name="submissionKey" value={data.submissionKey} /><button
    type="submit">Start assessment</button
  >
</form>
<a href="/app/assessment">Choose another track</a>
