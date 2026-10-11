<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>Reset password — Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Set a new password</h1>

{#if form?.message}
  <p role="alert">{form.message}</p>
{/if}

{#if data.token}
  <form method="POST">
    <input type="hidden" name="token" value={form?.token ?? data.token} />
    <div>
      <label for="password">New password</label>
      <input
        id="password"
        name="password"
        type="password"
        autocomplete="new-password"
        minlength="12"
        required
      />
    </div>
    <div>
      <label for="confirm">Confirm new password</label>
      <input
        id="confirm"
        name="confirm"
        type="password"
        autocomplete="new-password"
        minlength="12"
        required
      />
    </div>
    <button type="submit">Update password</button>
  </form>
{:else}
  <p role="alert">This reset link is invalid or has expired.</p>
{/if}

<p><a href="/recover">Request a new link</a> · <a href="/login">Sign in</a></p>
