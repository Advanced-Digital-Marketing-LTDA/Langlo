<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const lesson = (skillId: string) =>
    `/app/learn/${data.summary.language}/lesson/${encodeURIComponent(skillId)}?session=${encodeURIComponent(data.summary.id)}`;
</script>

<svelte:head>
  <title>Practice session · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Practice session</h1>
<p>{data.summary.answered} answers so far.</p>
{#if data.skills.length}
  <h2>Choose a topic</h2>
  <ul>
    {#each data.skills as skill (skill.skillId)}
      <li>
        <a href={lesson(skill.skillId)}
          >{skill.title}{skill.skillId === data.recommendedSkillId
            ? ' (recommended)'
            : ''}</a
        >
      </li>
    {/each}
  </ul>
{:else}
  <p>No lessons are published in this track yet.</p>
{/if}
<form method="POST" action="?/finish">
  <button type="submit">Finish session</button>
</form>
<p><a href="/app">Back to home</a></p>
