<script lang="ts">
  import { updated } from '$app/state';
  import { resolve } from '$app/paths';
  import { setContext } from 'svelte';
  let { children } = $props();

  let blockedAnswers = $state(0);
  setContext<(blocked: boolean) => void>(
    'app-version-refresh-blocked',
    (blocked) => {
      blockedAnswers += blocked ? 1 : -1;
    }
  );

  $effect(() => {
    if (updated.current && blockedAnswers === 0)
      window.location.href = window.location.href;
  });
</script>

<svelte:head><title>Langlo | Language Grammar Coach</title></svelte:head>

<a class="skip" href="#main">Skip to content</a>
<header>
  <a class="brand" href={resolve('/')}>langlo</a>
  <nav aria-label="Main navigation">
    <a href={resolve('/help')}>Help</a>
    <a href={resolve('/privacy')}>Privacy</a>
  </nav>
</header>
<main id="main" tabindex="-1">{@render children()}</main>
<footer>Local foundation · study features are still in development</footer>

<style>
  :global(body) {
    margin: 0;
    background: #f5f7fb;
    color: #172d46;
    font-family: system-ui, sans-serif;
    line-height: 1.6;
  }
  :global(*) {
    box-sizing: border-box;
  }
  :global(a) {
    color: #1b5982;
  }
  :global(a:focus-visible) {
    outline: 3px solid #d38e17;
    outline-offset: 4px;
  }
  :global(h1) {
    font-size: clamp(1.8rem, 5vw, 2.8rem);
    line-height: 1.2;
  }
  :global(h2) {
    line-height: 1.3;
  }
  :global(p) {
    max-width: 65ch;
  }
  .skip {
    position: fixed;
    top: -5rem;
    left: 1rem;
    padding: 0.6rem;
    background: white;
    z-index: 2;
  }
  .skip:focus {
    top: 1rem;
  }
  header {
    max-width: 70rem;
    margin: auto;
    padding: 1.5rem;
    display: flex;
    justify-content: space-between;
    gap: 1.5rem;
    align-items: center;
  }
  .brand {
    font-weight: 800;
    font-size: 1.5rem;
    text-decoration: none;
  }
  nav {
    display: flex;
    gap: 1.2rem;
  }
  main {
    max-width: 70rem;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    min-height: 65vh;
  }
  footer {
    max-width: 70rem;
    margin: auto;
    padding: 1.5rem;
    font-size: 0.9rem;
    color: #49617a;
  }
</style>
