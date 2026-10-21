<script lang="ts">
  import type { PageData } from './$types';
  import SkillMap from '../../../lib/components/SkillMap.svelte';

  let { data }: { data: PageData } = $props();
</script>

<SkillMap
  tracks={data.tracks}
  initialLanguage={data.initialLanguage}
  initialSearch={data.initialSearch}
  submissionKey={data.submissionKey}
/>
