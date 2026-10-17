<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Your content reports · Langlo</title></svelte:head>
<h1>Your content reports</h1>
<p>
  Your latest 100 reports. Reports identify concerns for review; they do not
  edit published content or change scores.
</p>
{#if !data.reports.length}<p>
    You have not reported any content issues yet.
  </p>{/if}
<ul>
  {#each data.reports as report (report.id)}<li>
      <p>{report.contentVersionId}</p>
      <p>{report.questionId ?? 'Lesson'} · {report.category}</p>
      {#if report.comment}<p class="comment">{report.comment}</p>{/if}
    </li>{/each}
</ul>
<a href="/app">Back to home</a>

<style>
  .comment {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
