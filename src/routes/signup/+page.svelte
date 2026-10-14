<script lang="ts">
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
  <title>Create account — Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Create an account</h1>

{#if form?.message}
  <p role="alert">{form.message}</p>
{/if}

<form method="POST">
  <div>
    <label for="name">Name</label>
    <input id="name" name="name" autocomplete="name" required />
  </div>
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
      autocomplete="new-password"
      minlength="12"
      maxlength="128"
      required
    />
  </div>
  <button type="submit">Create account</button>
</form>

<p><a href="/login">Already have an account? Sign in</a></p>
