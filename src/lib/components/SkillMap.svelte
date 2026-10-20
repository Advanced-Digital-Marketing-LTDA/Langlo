<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import type { StreamingTrackProgress } from '../server/progress';
  import type { GrammarStatus } from '../server/mastery';
  import { masteryLabels, masterySymbols } from '../dashboard';
  import { languageNames } from '../languageNames';
  import {
    filterSkillMap,
    layoutSkillMap,
    skillStateDistribution
  } from '../skill-map';
  import SkillProgressBar from './SkillProgressBar.svelte';

  let {
    tracks,
    initialLanguage,
    initialSearch,
    submissionKey
  }: {
    tracks: StreamingTrackProgress[];
    initialLanguage: string;
    initialSearch: string;
    submissionKey: string;
  } = $props();

  function initialParam(name: string) {
    return new URLSearchParams(initialSearch).get(name);
  }
  function initialValue(name: string, fallback = '') {
    return initialParam(name) ?? fallback;
  }
  function initialLanguageValue() {
    return initialValue('language', initialLanguage);
  }
  function loadAllProgress() {
    return Promise.all(
      tracks.map((track) => {
        void track.catalog.catch(() => undefined);
        return track.progress;
      })
    );
  }
  const allProgress = $derived(loadAllProgress());
  let language = $state(initialLanguageValue());
  let selectedSkill = $state(initialValue('skill'));
  let selectionCleared = $state(initialValue('focus') === 'none');
  let query = $state(initialValue('q'));
  let status = $state(initialValue('status'));
  let level = $state(initialValue('level'));
  let view = $state(initialValue('view') === 'list' ? 'list' : 'map');
  let zoom = $state(readZoom(initialParam('zoom')));
  let viewport = $state<HTMLDivElement>();
  let scrollTimer: ReturnType<typeof setTimeout>;
  const selectedTrack = $derived(
    tracks.find((track) => track.language === language)
  );

  function readZoom(value: string | null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0.45 && parsed <= 1.8
      ? parsed
      : 1;
  }

  function mapUrl(skillId = selectedSkill) {
    const params = new SvelteURLSearchParams();
    if (language) params.set('language', language);
    if (skillId) params.set('skill', skillId);
    else params.delete('skill');
    if (selectionCleared && !skillId) params.set('focus', 'none');
    else params.delete('focus');
    if (query) params.set('q', query);
    else params.delete('q');
    if (status) params.set('status', status);
    else params.delete('status');
    if (level) params.set('level', level);
    else params.delete('level');
    if (view === 'list') params.set('view', view);
    else params.delete('view');
    if (zoom !== 1) params.set('zoom', String(zoom));
    else params.delete('zoom');
    if (viewport?.scrollLeft)
      params.set('x', String(Math.round(viewport.scrollLeft)));
    if (viewport?.scrollTop)
      params.set('y', String(Math.round(viewport.scrollTop)));
    return `/app/map?${params}`;
  }

  function saveMapUrl(skillId = selectedSkill) {
    replaceState(mapUrl(skillId), page.state);
  }

  function updateParam(key: string, value: string) {
    if (key === 'q') query = value;
    else if (key === 'status') status = value;
    else if (key === 'level') level = value;
    else if (key === 'view') view = value === 'list' ? 'list' : 'map';
    saveMapUrl();
  }

  function selectLanguage(next: string) {
    language = next;
    selectedSkill = '';
    selectionCleared = false;
    saveMapUrl('');
    const track = tracks.find((item) => item.language === next);
    void track?.progress.then(
      (progress) => {
        if (progress.recommendation)
          focusTopic(progress.recommendation.skillId);
        else {
          const layout = layoutSkillMap(progress.skills);
          fitMap(layout.width, layout.height);
        }
      },
      () => undefined
    );
  }

  function selectSkill(skillId: string) {
    selectedSkill = skillId;
    selectionCleared = false;
    saveMapUrl(skillId);
  }

  function clearSelection(skillId: string) {
    selectedSkill = '';
    selectionCleared = true;
    saveMapUrl('');
    requestAnimationFrame(() => {
      document
        .getElementById(`map-skill-${encodeURIComponent(skillId)}`)
        ?.focus();
    });
  }

  function foundationIds(
    skills: Awaited<StreamingTrackProgress['progress']>['skills'],
    skillId: string
  ) {
    const byId = new Map(skills.map((skill) => [skill.skillId, skill]));
    const found = new SvelteSet<string>();
    const visit = (id: string) => {
      for (const prerequisite of byId.get(id)?.prerequisites ?? [])
        if (!found.has(prerequisite) && byId.has(prerequisite)) {
          found.add(prerequisite);
          visit(prerequisite);
        }
    };
    visit(skillId);
    return found;
  }

  function topicHref(skillId: string, map: string) {
    return `/app/learn/${encodeURIComponent(language)}/lesson/${encodeURIComponent(skillId)}?returnTo=${encodeURIComponent(map)}`;
  }

  function focusTopic(skillId: string) {
    selectSkill(skillId);
    requestAnimationFrame(() => {
      document
        .getElementById(`map-skill-${encodeURIComponent(skillId)}`)
        ?.scrollIntoView({ block: 'center', inline: 'center' });
    });
  }

  function changeZoom(amount: number) {
    zoom = Math.min(
      1.8,
      Math.max(0.45, Math.round((zoom + amount) * 100) / 100)
    );
    saveMapUrl();
  }

  function fitMap(width: number, height: number) {
    if (!viewport) return;
    zoom = Math.max(
      0.45,
      Math.min(
        1.2,
        viewport.clientWidth / width,
        viewport.clientHeight / height
      )
    );
    viewport.scrollTo({ left: 0, top: 0 });
    saveMapUrl();
  }

  function initializeMap(track: StreamingTrackProgress) {
    if (initialParam('skill') || initialParam('focus') === 'none') return;
    void track.progress.then(
      (progress) => {
        if (progress.recommendation)
          focusTopic(progress.recommendation.skillId);
        else {
          const layout = layoutSkillMap(progress.skills);
          fitMap(layout.width, layout.height);
        }
      },
      () => undefined
    );
  }

  function pan(dx: number, dy: number) {
    viewport?.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  }

  function rememberPosition() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => saveMapUrl(), 180);
  }

  function moveFocus(
    event: KeyboardEvent,
    node: { skillId: string; x: number; y: number },
    nodes: { skillId: string; x: number; y: number }[]
  ) {
    const direction = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowDown: [0, 1],
      ArrowUp: [0, -1]
    }[event.key];
    if (!direction) return;
    const [dx, dy] = direction;
    const next = nodes
      .map((item) => ({
        item,
        distance: (item.x - node.x) * dx + (item.y - node.y) * dy,
        cross: Math.abs((item.x - node.x) * dy - (item.y - node.y) * dx)
      }))
      .filter(({ item, distance }) => item !== node && distance > 0)
      .sort((a, b) => a.cross - b.cross || a.distance - b.distance)[0]?.item;
    if (next) {
      event.preventDefault();
      selectSkill(next.skillId);
      document
        .getElementById(`map-skill-${encodeURIComponent(next.skillId)}`)
        ?.focus();
    }
  }

  onMount(() => {
    if (viewport) {
      viewport.scrollLeft = Math.max(0, Number(initialParam('x')) || 0);
      viewport.scrollTop = Math.max(0, Number(initialParam('y')) || 0);
    }
    if (selectedTrack) initializeMap(selectedTrack);
  });
</script>

<svelte:head><title>Grammar skill map · Langlo</title></svelte:head>

<h1>Grammar skill map</h1>
{#if !tracks.length}
  <p>You have no enrolled language tracks yet.</p>
  <p><a href="/app/settings">Choose a language</a></p>
{:else}
  {#await allProgress}
    <p aria-busy="true">Calculating overall skill progress…</p>
  {:then progressTracks}
    <SkillProgressBar
      title="Overall skill progress"
      distribution={skillStateDistribution(
        progressTracks.flatMap((track) => track.skills)
      )}
    />
  {:catch}
    <p class="error-box" role="alert">
      Overall skill progress could not be loaded. <a href="/app/map">Retry</a>
    </p>
  {/await}

  <nav class="languages" aria-label="Enrolled languages">
    {#each tracks as track (track.language)}
      <button
        type="button"
        aria-pressed={language === track.language}
        onclick={() => selectLanguage(track.language)}
        >{languageNames[track.language] ?? track.language}</button
      >
    {/each}
  </nav>

  {#if selectedTrack}
    <section aria-label={`${language.toUpperCase()} skill map`}>
      <h2>{language.toUpperCase()} · starting level {selectedTrack.level}</h2>
      {#await selectedTrack.catalog}
        <div aria-busy="true" aria-label="Loading topic catalog">
          Loading topics…
        </div>
      {:then catalog}
        {#await selectedTrack.progress}
          <ul class="nodes loading" aria-busy="true">
            {#each catalog.skills as skill (skill.skillId)}
              <li><span>{skill.title}</span><span>Checking progress…</span></li>
            {/each}
          </ul>
        {:then progress}
          {@const distribution = skillStateDistribution(progress.skills)}
          {@const layout = layoutSkillMap(progress.skills)}
          {@const filters = filterSkillMap(progress.skills, {
            query,
            status: status as GrammarStatus | '',
            level,
            selectedSkillId: selectedSkill || progress.recommendation?.skillId
          })}
          {@const shown = layout.nodes.filter((node) =>
            filters.visibleIds.has(node.skillId)
          )}
          {@const shownIds = new Set(shown.map((node) => node.skillId))}
          {@const edges = layout.edges.filter(
            (edge) => shownIds.has(edge.from) && shownIds.has(edge.to)
          )}
          {@const activeSkillId =
            selectedSkill ||
            (!selectionCleared ? (progress.recommendation?.skillId ?? '') : '')}
          {@const activeSkill = progress.skills.find(
            (skill) => skill.skillId === activeSkillId
          )}
          {@const foundations = activeSkill
            ? foundationIds(progress.skills, activeSkill.skillId)
            : new Set<string>()}
          {@const map = mapUrl(activeSkillId)}

          <SkillProgressBar
            title={`${language.toUpperCase()} skill progress`}
            headingLevel={3}
            {distribution}
          />

          {#if !progress.skills.length}
            <p>No published skills are available in this track yet.</p>
          {:else}
            {#if progress.recommendation}
              <p class="recommended">
                <strong>Recommended topic:</strong>
                <button
                  type="button"
                  onclick={() => focusTopic(progress.recommendation!.skillId)}
                  >{progress.skills.find(
                    (skill) =>
                      skill.skillId === progress.recommendation?.skillId
                  )?.title}</button
                >
                — {progress.recommendation.reason}
              </p>
            {/if}

            <div class="filters">
              <label
                >Search topics <input
                  type="search"
                  maxlength="100"
                  value={query}
                  oninput={(event) =>
                    updateParam('q', event.currentTarget.value)}
                /></label
              >
              <label
                >Mastery state
                <select
                  value={status}
                  oninput={(event) =>
                    updateParam('status', event.currentTarget.value)}
                >
                  <option value="">All states</option>
                  {#each ['secure', 'practising', 'weak', 'unknown'] as state (state)}
                    <option value={state}
                      >{masteryLabels[state as GrammarStatus]}</option
                    >
                  {/each}
                </select>
              </label>
              <label
                >Level
                <select
                  value={level}
                  oninput={(event) =>
                    updateParam('level', event.currentTarget.value)}
                >
                  <option value="">All levels</option>
                  {#each [...new Set(progress.skills.map((skill) => skill.level))] as item (item)}
                    <option value={item}>{item}</option>
                  {/each}
                </select>
              </label>
              <div class="view-toggle" aria-label="Map display">
                <button
                  type="button"
                  aria-pressed={view === 'map'}
                  onclick={() => updateParam('view', '')}>Map</button
                >
                <button
                  type="button"
                  aria-pressed={view === 'list'}
                  onclick={() => updateParam('view', 'list')}>List view</button
                >
              </div>
            </div>

            {#if view === 'map'}
              <div class="map-controls" aria-label="Map controls">
                <button
                  type="button"
                  aria-label="Zoom out"
                  onclick={() => changeZoom(-0.2)}>−</button
                >
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  onclick={() => changeZoom(0.2)}>+</button
                >
                <button
                  type="button"
                  onclick={() => fitMap(layout.width, layout.height)}
                  >Fit map</button
                >
                {#if progress.recommendation}<button
                    type="button"
                    onclick={() => focusTopic(progress.recommendation!.skillId)}
                    >Go to recommended topic</button
                  >{/if}
                <button
                  type="button"
                  aria-label="Pan left"
                  onclick={() => pan(-220, 0)}>←</button
                >
                <button
                  type="button"
                  aria-label="Pan up"
                  onclick={() => pan(0, -180)}>↑</button
                >
                <button
                  type="button"
                  aria-label="Pan down"
                  onclick={() => pan(0, 180)}>↓</button
                >
                <button
                  type="button"
                  aria-label="Pan right"
                  onclick={() => pan(220, 0)}>→</button
                >
              </div>
              <div class="workspace">
                <div
                  class="viewport"
                  bind:this={viewport}
                  onscroll={rememberPosition}
                  role="region"
                  aria-label={`${language.toUpperCase()} topic map. Scroll or use pan controls to explore.`}
                >
                  <div
                    class="scaled"
                    style={`width:${layout.width * zoom}px;height:${layout.height * zoom}px`}
                  >
                    <div
                      class="canvas"
                      style={`width:${layout.width}px;height:${layout.height}px;transform:scale(${zoom})`}
                    >
                      <svg
                        width={layout.width}
                        height={layout.height}
                        aria-hidden="true"
                      >
                        {#each layout.levels as band (band.level)}
                          <rect
                            class="level-band"
                            x="0"
                            y={band.y - 28}
                            width={layout.width}
                            height={band.height}
                            rx="8"
                          />
                          <text class="level-title" x="14" y={band.y - 9}
                            >{band.level} topics</text
                          >
                        {/each}
                        {#each edges as edge (`${edge.from}-${edge.to}`)}
                          {@const from = layout.positions.get(edge.from)!}
                          {@const to = layout.positions.get(edge.to)!}
                          <path
                            d={`M ${from.x + 208} ${from.y + 44} C ${from.x + 238} ${from.y + 44}, ${to.x - 30} ${to.y + 44}, ${to.x} ${to.y + 44}`}
                          />
                        {/each}
                      </svg>
                      {#each shown as node (node.skillId)}
                        <button
                          id={`map-skill-${encodeURIComponent(node.skillId)}`}
                          data-skill-id={node.skillId}
                          class="node"
                          class:matching={filters.matchingIds.has(
                            node.skillId
                          ) &&
                            (query || status || level)}
                          class:dimmed={(query || status || level) &&
                            !filters.matchingIds.has(node.skillId)}
                          class:foundation={foundations.has(node.skillId)}
                          class:unavailable-node={!node.available}
                          class:selected={activeSkillId === node.skillId}
                          style={`left:${node.x}px;top:${node.y}px`}
                          aria-pressed={activeSkillId === node.skillId}
                          onclick={() => selectSkill(node.skillId)}
                          onkeydown={(event) => moveFocus(event, node, shown)}
                        >
                          <span class="node-level">{node.level}</span>
                          <strong>{node.title}</strong>
                          <span
                            >{masterySymbols[node.status]}
                            {masteryLabels[node.status]}</span
                          >
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
                {#if activeSkill}
                  {@render detailsPanel(
                    activeSkill,
                    progress,
                    foundations,
                    map
                  )}
                {/if}
              </div>
            {:else}
              <div class="workspace list-workspace">
                <ul class="nodes list">
                  {#each shown as node (node.skillId)}
                    <li>
                      <button
                        type="button"
                        aria-pressed={activeSkillId === node.skillId}
                        onclick={() => selectSkill(node.skillId)}
                      >
                        <span class="node-level">{node.level}</span>
                        <strong>{node.title}</strong>
                        <span
                          >{masterySymbols[node.status]}
                          {masteryLabels[node.status]}</span
                        >
                      </button>
                    </li>
                  {/each}
                </ul>
                {#if activeSkill}
                  {@render detailsPanel(
                    activeSkill,
                    progress,
                    foundations,
                    map
                  )}
                {/if}
              </div>
            {/if}
            {#if !shown.length}<p>No topics match these filters.</p>{/if}
            <p class="evidence-note">
              Grammar evidence comes from qualifying independent exercises and
              completed assessments. Flashcard recall and session completion are
              separate signals.
            </p>
          {/if}
        {:catch}
          <p class="error-box" role="alert">
            {language.toUpperCase()} progress could not be loaded.
            <a href="/app/map">Refresh to try again</a>.
          </p>
        {/await}
      {:catch}
        <p class="error-box" role="alert">
          {language.toUpperCase()} topics could not be loaded.
          <a href="/app/map">Refresh to try again</a>.
        </p>
      {/await}
    </section>
  {/if}
{/if}

{#snippet detailsPanel(
  skill: Awaited<StreamingTrackProgress['progress']>['skills'][number],
  progress: Awaited<StreamingTrackProgress['progress']>,
  foundations: Set<string>,
  map: string
)}
  <aside class="topic-panel" aria-label={`${skill.title} details`}>
    <button
      class="close-panel"
      type="button"
      onclick={() => clearSelection(skill.skillId)}>Close topic details</button
    >
    <h3>{skill.title}</h3>
    <p>{masterySymbols[skill.status]} {masteryLabels[skill.status]}</p>
    <p>{skill.reason}</p>
    <p>{skill.independentItems} qualifying items · {skill.sessions} sessions</p>
    <p>
      Practised {skill.practisedSessions}
      {skill.practisedSessions === 1 ? 'time' : 'times'} ·
      {skill.answers}
      {skill.answers === 1 ? 'answer' : 'answers'}
    </p>
    <details>
      <summary>Evidence details</summary>
      <p>Correct: {skill.correct}; incorrect: {skill.incorrect}.</p>
      <p>
        Policy {skill.policyVersion}. Secure requires five distinct items over
        two sessions and at least 80% correct.
      </p>
    </details>
    {#if skill.prerequisites.length}
      <h4>Recommended foundations</h4>
      <ul>
        {#each skill.prerequisites as prerequisite (prerequisite)}
          {@const foundation = progress.skills.find(
            (item) => item.skillId === prerequisite
          )}
          {#if foundation}
            <li>
              <button
                type="button"
                onclick={() => selectSkill(foundation.skillId)}
              >
                {foundation.title} — {masteryLabels[foundation.status]}
              </button>
              {#if foundations.has(foundation.skillId)}<span>
                  Foundation highlighted on map.</span
                >{/if}
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
    {#if skill.available}
      <p><a href={topicHref(skill.skillId, map)}>Open lesson</a></p>
      <form method="POST" action="?/practise">
        <input type="hidden" name="language" value={language} />
        <input type="hidden" name="skillId" value={skill.skillId} />
        <input type="hidden" name="submissionKey" value={submissionKey} />
        <input type="hidden" name="returnTo" value={map} />
        <button type="submit">Practise this topic</button>
      </form>
    {/if}
  </aside>
{/snippet}

<style>
  h1 {
    margin-bottom: 1rem;
  }
  .languages,
  .filters,
  .map-controls,
  .view-toggle {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: end;
  }
  .languages {
    margin-block: 1rem;
  }
  button,
  select,
  input {
    min-height: 44px;
  }
  button {
    cursor: pointer;
  }
  .filters {
    margin-block: 1rem;
  }
  .filters label {
    display: grid;
    gap: 0.25rem;
  }
  .recommended {
    padding: 0.75rem;
    border-inline-start: 4px solid #2766a8;
    background: #f1f6fb;
  }
  .recommended button {
    border: 0;
    padding: 0;
    min-height: auto;
    background: transparent;
    text-decoration: underline;
    font: inherit;
    font-weight: 700;
  }
  .map-controls {
    margin-bottom: 0.5rem;
  }
  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
    gap: 1rem;
    align-items: start;
  }
  .viewport {
    min-width: 0;
    max-width: 100%;
    height: min(70vh, 42rem);
    overflow: auto;
    border: 1px solid #b8c6d8;
    border-radius: 0.5rem;
    background: #f7f9fc;
    touch-action: pan-x pan-y;
  }
  .viewport:focus-visible {
    outline: 3px solid #d38e17;
    outline-offset: 2px;
  }
  .scaled {
    position: relative;
  }
  .canvas {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
  }
  svg {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  path {
    fill: none;
    stroke: #94a3b8;
    stroke-width: 3;
  }
  .level-band {
    fill: #eef2f6;
    stroke: #d7e0ea;
  }
  .level-title {
    fill: #344054;
    font-size: 14px;
    font-weight: 700;
  }
  .node {
    position: absolute;
    display: grid;
    align-content: start;
    gap: 0.25rem;
    width: 208px;
    min-height: 88px;
    padding: 0.65rem 0.75rem;
    border: 2px solid #94a3b8;
    border-radius: 0.55rem;
    background: white;
    color: #172d46;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .node-level {
    color: #475467;
    font-size: 0.78rem;
    font-weight: 700;
  }
  .node:hover,
  .node:focus-visible,
  .node.selected {
    border-color: #172d46;
    box-shadow: 0 0 0 2px #dce7f2;
  }
  .node.matching {
    outline: 3px solid #d38e17;
    outline-offset: 2px;
  }
  .node.dimmed {
    opacity: 0.55;
  }
  .node.foundation {
    border-color: #2766a8;
  }
  .node.unavailable-node {
    border-style: dashed;
    background: #f1f3f5;
    color: #344054;
  }
  .topic-panel {
    position: sticky;
    top: 1rem;
    max-height: 70vh;
    overflow: auto;
    padding: 1rem;
    border: 1px solid #b8c6d8;
    border-radius: 0.55rem;
    background: white;
  }
  .close-panel {
    float: right;
  }
  .topic-panel h3 {
    margin-top: 2.5rem;
  }
  .topic-panel li {
    margin-block: 0.35rem;
  }
  .topic-panel form {
    margin-block: 0.75rem;
  }
  .list-workspace {
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
  }
  .nodes {
    padding: 0;
    list-style: none;
  }
  .list {
    display: grid;
    gap: 0.5rem;
  }
  .list button {
    display: flex;
    flex-wrap: wrap;
    width: 100%;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.65rem;
    border: 1px solid #b8c6d8;
    border-radius: 0.5rem;
    background: white;
    text-align: left;
  }
  .loading li {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem;
  }
  .evidence-note {
    margin-block: 1rem;
  }
  @media (max-width: 720px) {
    .workspace,
    .list-workspace {
      display: block;
    }
    .viewport {
      height: 55vh;
    }
    .topic-panel {
      position: fixed;
      z-index: 4;
      inset: auto 0 0;
      max-height: 58dvh;
      border-radius: 1rem 1rem 0 0;
      box-shadow: 0 -8px 32px #172d4630;
    }
    .list-workspace .topic-panel {
      position: fixed;
    }
  }
</style>
