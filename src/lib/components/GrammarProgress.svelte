<script lang="ts">
  import type { TrackProgress } from '../server/progress';
  import Chip from '../prototype/Chip.svelte';
  let {
    tracks,
    details = false
  }: { tracks: TrackProgress[]; details?: boolean } = $props();
  const labels = {
    unknown: 'Unknown',
    weak: 'Weak',
    practising: 'Practising',
    secure: 'Secure'
  };
  const symbols = { unknown: '○', weak: '!', practising: '◐', secure: '✓' };
</script>

<nav aria-label="Study navigation">
  <a href="/app">Home</a> · <a href="/app/map">Skill map</a> ·
  <a href="/app/progress">Progress</a>
  · <a href="/app/assessment">Assessment</a>
</nav>
<p>
  Grammar evidence comes from qualifying independent exercises and completed
  assessments. Flashcard recall, review due dates and session completion are
  separate signals.
</p>
<p>
  Unknown means there is no qualifying evidence; weak topics need attention;
  practising means more evidence is needed; secure means the current evidence
  meets the policy. Prerequisites suggest a teaching order. You can open any
  available topic.
</p>
{#if !tracks.length}<p>You have no enrolled tracks yet.</p>{/if}
{#each tracks as track (track.language)}
  <section aria-label={`${track.language.toUpperCase()} grammar`}>
    <h2>{track.language.toUpperCase()} · starting level {track.level}</h2>
    {#if track.recommendation}
      <aside aria-label="Recommended topic">
        <p>
          <strong>Recommended:</strong>
          <a
            href={`/app/learn/${track.language}/lesson/${track.recommendation.skillId}`}
            >{track.skills.find(
              (skill) => skill.skillId === track.recommendation?.skillId
            )?.title}</a
          >
        </p>
        <p>{track.recommendation.reason}</p>
      </aside>
    {/if}
    {#if !track.skills.length}<p>
        No published skills are available in this track yet.
      </p>{/if}
    {#each ['A1', 'A2'] as level (level)}
      {#if track.skills.some((skill) => skill.level === level)}
        <h3>{level} topics</h3>
        <ul class="skills">
          {#each track.skills.filter((skill) => skill.level === level) as skill (skill.skillId)}
            <li id={skill.skillId}>
              <h4>{skill.title}</h4>
              <Chip
                variant="mastery"
                label={labels[skill.status]}
                symbol={symbols[skill.status]}
              />
              <p>
                {skill.independentItems} qualifying items · {skill.sessions} sessions
              </p>
              <p>{skill.reason}</p>
              {#if skill.prerequisites.length}<p>Recommended foundations:</p>
                <ul>
                  {#each skill.prerequisites as prerequisite (prerequisite)}<li>
                      <a href={`#${prerequisite}`}
                        >{track.skills.find(
                          (item) => item.skillId === prerequisite
                        )?.title ?? prerequisite}</a
                      >
                      — {labels[
                        track.skills.find(
                          (item) => item.skillId === prerequisite
                        )?.status ?? 'unknown'
                      ]}
                    </li>{/each}
                </ul>{/if}
              {#if skill.available}<p>
                  <a
                    href={`/app/learn/${track.language}/lesson/${skill.skillId}`}
                    >Open {skill.title}</a
                  >
                </p>{:else}<p>
                  Lesson temporarily unavailable or not published yet.
                </p>{/if}
              <details open={details}>
                <summary>Evidence details</summary>
                <p>
                  Correct: {skill.correct}; incorrect: {skill.incorrect}.
                  Uncertain and assisted answers add no independent evidence.
                </p>
                <p>
                  Policy {skill.policyVersion}. Secure requires five distinct
                  items over two sessions and at least 80% correct. This does
                  not certify a CEFR level.
                </p>
              </details>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  </section>
{/each}

<style>
  .skills {
    display: grid;
    gap: 1rem;
    list-style: none;
    padding: 0;
  }
  .skills > li {
    padding: 1rem;
    border: 1px solid #b8c6d8;
    border-radius: 0.5rem;
    overflow-wrap: anywhere;
  }
  .skills > li:target {
    outline: 3px solid #d38e17;
    outline-offset: 3px;
  }
  h4 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
</style>
