<script lang="ts">
  import type { skillStateDistribution } from '../skill-map';
  import { masteryLabels } from '../dashboard';

  let {
    title,
    distribution,
    headingLevel = 2
  }: {
    title: string;
    distribution: ReturnType<typeof skillStateDistribution>;
    headingLevel?: 2 | 3;
  } = $props();
</script>

<section class="progress" aria-label={title}>
  <svelte:element this={headingLevel === 3 ? 'h3' : 'h2'}
    >{title}</svelte:element
  >
  {#if distribution.total}
    <div
      class="bar"
      role="img"
      aria-label={distribution.segments
        .map(
          ({ status, count, percent }) =>
            `${count} ${masteryLabels[status]} (${percent}%)`
        )
        .join(', ')}
    >
      {#each distribution.segments as segment (segment.status)}
        <span
          class={segment.status}
          style={`width:${segment.percent}%`}
          aria-hidden="true"
        ></span>
      {/each}
    </div>
    <ul class="legend">
      {#each distribution.segments as segment (segment.status)}
        <li>
          <strong>{segment.percent}% {masteryLabels[segment.status]}</strong>
          <span>{segment.count} {segment.count === 1 ? 'skill' : 'skills'}</span
          >
        </li>
      {/each}
    </ul>
  {:else}
    <p>No skills available to measure yet</p>
  {/if}
</section>

<style>
  .progress {
    margin-block: 1rem 1.5rem;
  }
  h2,
  h3 {
    margin-bottom: 0.5rem;
  }
  .bar {
    display: flex;
    height: 1rem;
    overflow: hidden;
    border-radius: 999px;
    background: #e6ebf1;
  }
  .secure {
    background: #176b46;
  }
  .practising {
    background: #2766a8;
  }
  .weak {
    background: #9a4c00;
  }
  .unknown {
    background: #667085;
  }
  .legend {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.35rem 0.75rem;
    padding: 0;
    list-style: none;
  }
  .legend li {
    display: flex;
    justify-content: space-between;
    gap: 0.4rem;
  }
</style>
