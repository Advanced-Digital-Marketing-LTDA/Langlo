<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import {
    attachStudyTimer,
    createStudyTimer,
    sendStudySegment,
    type StudyCategory
  } from '../study-timer';

  let { category }: { category: StudyCategory } = $props();

  // Leaving for the analytics tab saves the last segment after that page's
  // data has loaded, so refresh it once the save is done.
  const saved = () => {
    if (page.url.pathname === '/app/analytics') return invalidateAll();
  };

  onMount(() =>
    attachStudyTimer(
      createStudyTimer(category, (segment) => {
        void sendStudySegment(segment).then(saved);
      }),
      window,
      document
    )
  );
</script>
