<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  let { children } = $props();
  // Marks the shell interactive, so browser tests never click server-rendered
  // controls before their handlers are attached.
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });
  const tabs = [
    { href: '/prototype', label: 'Home' },
    { href: '/prototype/map', label: 'Map' },
    { href: '/prototype/review', label: 'Review' },
    { href: '/prototype/decks', label: 'Decks' },
    { href: '/prototype/settings', label: 'Settings' }
  ] as const;
  const pathname = $derived(page.url.pathname.replace(/\/+$/, ''));
  const focusMode = $derived(
    pathname === '/prototype/practice' || pathname === '/prototype/review'
  );
</script>

<svelte:head>
  <meta name="robots" content="noindex,nofollow" />
  <title>Langlo | Design prototype</title>
</svelte:head>

<div class="prototype" data-hydrated={hydrated || undefined}>
  <p class="banner" role="note">
    Design prototype — synthetic data · no real account or saved progress
  </p>

  {#if focusMode}
    <header class="focus-header">
      <a href={resolve('/prototype')}>← Exit session</a>
      <span class="focus-note"
        >Focus view — navigation returns when you exit</span
      >
    </header>
  {:else}
    <nav class="mainnav" aria-label="Prototype navigation">
      {#each tabs as tab (tab.href)}
        <a
          href={resolve(tab.href)}
          aria-current={pathname === tab.href ? 'page' : undefined}
          >{tab.label}</a
        >
      {/each}
    </nav>
  {/if}

  {@render children()}
</div>

<style>
  .prototype {
    max-width: 62rem;
    margin: 0 auto;
  }
  .banner {
    margin: 0 0 1.25rem;
    padding: 0.5rem 0.8rem;
    border: 1px solid #e4cf9a;
    border-radius: 0.5rem;
    background: #fbf3dd;
    color: #5d4a12;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .mainnav {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-bottom: 1.75rem;
  }
  .mainnav a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0.4rem 0.9rem;
    border: 1px solid #d9e2ef;
    border-radius: 0.6rem;
    background: white;
    text-decoration: none;
    font-weight: 600;
  }
  .mainnav a[aria-current='page'] {
    background: #172d46;
    color: white;
    border-color: #172d46;
  }
  .focus-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 1.75rem;
  }
  .focus-note {
    color: #49617a;
    font-size: 0.85rem;
  }
  @media (max-width: 720px) {
    .mainnav {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 5;
      margin: 0;
      padding: 0.4rem;
      background: white;
      border-top: 1px solid #d9e2ef;
      justify-content: space-around;
      flex-wrap: nowrap;
    }
    .mainnav a {
      flex: 1;
      justify-content: center;
      padding: 0.4rem 0.2rem;
      font-size: 0.85rem;
    }
    .prototype {
      padding-bottom: 5rem;
    }
  }
  :global(
    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible,
    summary:focus-visible,
    [role='switch']:focus-visible
  ) {
    outline: 3px solid #d38e17;
    outline-offset: 2px;
  }
</style>
