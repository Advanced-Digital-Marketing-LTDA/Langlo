<script lang="ts">
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
  <title>Sign in — Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Sign in</h1>
<p>Langlo is a private pilot. Accounts are provisioned by the operator.</p>

{#if form?.message}
  <p role="alert">{form.message}</p>
{/if}

<form method="POST">
  <div>
    <label for="email">Email</label>
    <input
      id="email"
      name="email"
      type="email"
      autocomplete="email"
      value={form?.email ?? ''}
      required
    />
  </div>
  <div>
    <label for="password">Password</label>
    <input
      id="password"
      name="password"
      type="password"
      autocomplete="current-password"
      required
    />
  </div>
  <button type="submit">Sign in</button>
</form>

<p><a href="/recover">Forgot your password?</a></p>
