<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { hydration } from '../../lib/hydration.svelte';
  let { children } = $props();
  onMount(() => {
    hydration.ready = true;
  });
  const tabs = [
    { href: '/app', label: 'Home' },
    { href: '/app/map', label: 'Skill map' },
    { href: '/app/assessment', label: 'Assessment' },
    { href: '/app/review', label: 'Review' },
    { href: '/app/library', label: 'Library' },
    { href: '/app/decks', label: 'Decks' },
    { href: '/app/analytics', label: 'Analytics' },
    { href: '/app/settings', label: 'Settings' },
    { href: '/app/reports', label: 'Reports' }
  ] as const;
  const pathname = $derived(page.url.pathname.replace(/\/+$/, '') || '/');
  const current = (href: string) =>
    pathname === href || (href !== '/app' && pathname.startsWith(`${href}/`));
</script>

<div data-hydrated={hydration.ready || undefined}>
  <nav class="appnav" aria-label="Study navigation">
    {#each tabs as tab (tab.href)}
      <a href={tab.href} aria-current={current(tab.href) ? 'page' : undefined}
        >{tab.label}</a
      >
    {/each}
  </nav>

  {@render children()}
</div>

<style>
  .appnav {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-bottom: 1.75rem;
  }
  .appnav a {
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
  .appnav a[aria-current='page'] {
    background: #172d46;
    color: white;
    border-color: #172d46;
  }
  @media (max-width: 720px) {
    .appnav {
      position: sticky;
      top: 0;
      z-index: 5;
      margin: 0 -1.5rem 1.25rem;
      padding: 0.4rem 1.5rem;
      background: #f5f7fb;
      flex-wrap: nowrap;
      overflow-x: auto;
    }
    .appnav a {
      white-space: nowrap;
    }
  }
</style>
