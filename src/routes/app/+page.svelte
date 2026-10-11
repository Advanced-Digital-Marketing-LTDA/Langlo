<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Signed in as {data.user.name}</h1>
<p>This account is part of the private Langlo pilot.</p>

<form method="POST" action="?/signOut">
  <button type="submit">Sign out</button>
</form>
