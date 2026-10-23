<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createStudyTimer,
    sendStudySegment,
    type StudyCategory
  } from '../study-timer';

  let { category }: { category: StudyCategory } = $props();

  onMount(() => {
    const timer = createStudyTimer(category, (segment) => {
      void sendStudySegment(segment);
    });
    const activity = () => {
      if (document.visibilityState === 'visible') timer.activity(Date.now());
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') timer.activity(Date.now());
      else timer.stop(Date.now());
    };
    const leave = () => timer.stop(Date.now());
    const events = ['pointerdown', 'keydown', 'input'] as const;
    for (const name of events) window.addEventListener(name, activity);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    activity();
    return () => {
      for (const name of events) window.removeEventListener(name, activity);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  });
</script>
