<script lang="ts">
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
  <title>Recover account — Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Recover your account</h1>
<p>Enter your account email and we will send a reset link.</p>

{#if form?.message}
  <p role="status">{form.message}</p>
{:else}
  <form method="POST">
    <div>
      <label for="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autocomplete="email"
        required
      />
    </div>
    <button type="submit">Send reset link</button>
  </form>
{/if}

<p><a href="/login">Back to sign in</a></p>
