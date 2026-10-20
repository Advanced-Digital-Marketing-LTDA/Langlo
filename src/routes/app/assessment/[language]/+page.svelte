<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Start assessment · Langlo</title></svelte:head>
<h1>Assess {data.language.toUpperCase()} {data.level} grammar</h1>
<p>
  You will answer one unseen question for each active skill across all levels in
  this language.
</p>
<p>
  Results and expected answers stay hidden until you finish. Choose Not sure
  whenever you need to. This assessment guides practice; it is not a CEFR
  qualification.
</p>
<form method="POST" action="?/start">
  <input type="hidden" name="submissionKey" value={data.submissionKey} /><button
    type="submit">Start assessment</button
  >
</form>
<a href="/app/assessment">Choose another track</a>
