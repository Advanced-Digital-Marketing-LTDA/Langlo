<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Chip from '../../../lib/prototype/Chip.svelte';
  import StateSwitcher from '../../../lib/prototype/StateSwitcher.svelte';
  import { defaultResults, outcomeLabel } from '../../../lib/prototype/data';
  import { prototypeSession } from '../../../lib/prototype/session.svelte';
  import {
    deriveMissedItems,
    draftIdFor,
    mistakePreview,
    type MissedItem
  } from '../../../lib/prototype/results';

  const screenState = $derived(page.url.searchParams.get('state') ?? 'normal');

  function readCount(name: string, fallback: number): number {
    const raw = Number.parseInt(page.url.searchParams.get(name) ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  }
  const correct = $derived(readCount('correct', defaultResults.correct));
  const incorrect = $derived(readCount('incorrect', defaultResults.incorrect));
  const uncertain = $derived(readCount('uncertain', defaultResults.uncertain));

  const missedItems = $derived(
    deriveMissedItems(prototypeSession.answers, incorrect)
  );
  const mistakesDeck = prototypeSession.decks.find(
    (d) => d.id === 'deck-mistakes'
  );

  const isKept = (missed: MissedItem) =>
    mistakesDeck?.notes.some((note) => note.id === draftIdFor(missed)) ?? false;
  const anyKept = $derived(missedItems.some((missed) => isKept(missed)));

  function keepAsFlashcard(missed: MissedItem) {
    if (!mistakesDeck) return;
    const id = draftIdFor(missed);
    if (mistakesDeck.notes.some((note) => note.id === id)) return;
    mistakesDeck.notes.push({
      id,
      kind: 'basic',
      preview: mistakePreview(missed),
      status: 'draft',
      scheduling: 'new'
    });
  }
</script>

<svelte:head><title>Session results | Langlo prototype</title></svelte:head>

<StateSwitcher states={['normal', 'loading', 'error', 'evaluating']} />

<h1>Session results</h1>
<p class="subtle">Practice · French A1 · just now</p>

{#if screenState === 'loading'}
  <div class="panel" aria-busy="true" aria-label="Loading session results">
    <div class="skel"></div>
    <div class="skel short"></div>
    <p class="muted">Loading your results…</p>
  </div>
{:else if screenState === 'error'}
  <div class="panel" role="alert">
    <h2>Results unavailable</h2>
    <p>
      This session's results could not be loaded. Your recorded attempts and
      evaluations are unchanged.
    </p>
    <a class="button" href={resolve('/prototype/results')}>Retry</a>
  </div>
{:else}
  <section class="panel" aria-labelledby="outcomes-heading">
    <h2 id="outcomes-heading">How it went</h2>
    <dl class="totals">
      <div class="total">
        <dt>
          <Chip variant="outcome" symbol="✓" label={outcomeLabel.correct} />
        </dt>
        <dd>{correct}</dd>
      </div>
      <div class="total">
        <dt>
          <Chip variant="outcome" symbol="✗" label={outcomeLabel.incorrect} />
        </dt>
        <dd>{incorrect}</dd>
      </div>
      <div class="total">
        <dt>
          <Chip variant="outcome" symbol="?" label={outcomeLabel.uncertain} />
        </dt>
        <dd>{uncertain}</dd>
      </div>
    </dl>
    {#if screenState === 'evaluating'}
      <p class="pending" role="status">
        ◌ One item is still being evaluated — its outcome will appear here when
        it finishes.
      </p>
    {/if}
  </section>

  <section class="panel" aria-labelledby="evidence-heading">
    <h2 id="evidence-heading">Grammar evidence</h2>
    <p class="signal-note">
      Updates your grammar mastery only — flashcard recall is unchanged.
    </p>
    <ul>
      {#each defaultResults.skillEvidence as evidence (evidence.skillId)}
        <li>
          <strong>{evidence.skill}</strong><br />
          <span class="muted">{evidence.change}</span>
        </li>
      {/each}
    </ul>
  </section>

  {#if missedItems.length > 0}
    <section class="panel" aria-labelledby="missed-heading">
      <h2 id="missed-heading">Keep a mistake as a flashcard</h2>
      <ul>
        {#each missedItems as missed (missed.prompt)}
          <li class="missed">
            <p class="prompt">{missed.prompt}</p>
            <p>
              Your answer: {missed.yourAnswer}<br />
              Accepted: <strong>{missed.expected}</strong>
            </p>
            {#if isKept(missed)}
              <p class="muted">Added to drafts — approve it in Decks.</p>
            {:else}
              <button
                class="secondary"
                type="button"
                onclick={() => keepAsFlashcard(missed)}
                >Keep as flashcard</button
              >
            {/if}
          </li>
        {/each}
      </ul>
      {#if anyKept}
        <p role="status" class="announced">
          Draft card created. It stays a draft until you approve it.
        </p>
      {/if}
    </section>
  {:else}
    <section class="panel" aria-labelledby="missed-heading">
      <h2 id="missed-heading">Keep a mistake as a flashcard</h2>
      <p class="muted">No mistakes this session — nothing to keep.</p>
    </section>
  {/if}

  <div class="actions">
    <a class="button" href={resolve('/prototype/review')}>Review due cards</a>
    <a href={resolve('/prototype/decks')}>See card drafts</a>
    <a href={resolve('/prototype/map')}>Back to the map</a>
  </div>
{/if}

<style>
  .subtle {
    color: #49617a;
    margin-top: -0.8rem;
  }
  .panel {
    padding: 1.25rem;
    background: white;
    border: 1px solid #d9e2ef;
    border-radius: 0.8rem;
    margin-bottom: 1.25rem;
  }
  .totals {
    display: flex;
    gap: 2rem;
    margin: 0;
    flex-wrap: wrap;
  }
  .total {
    text-align: center;
  }
  .total dt {
    margin-bottom: 0.3rem;
  }
  .total dd {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
  }
  .pending {
    margin: 1rem 0 0;
    padding: 0.5rem 0.8rem;
    background: #fbf3dd;
    border: 1px solid #e4cf9a;
    border-radius: 0.5rem;
    color: #5d4a12;
  }
  .signal-note,
  .muted {
    color: #49617a;
    font-size: 0.9rem;
  }
  .missed {
    padding: 0.6rem 0;
  }
  .prompt {
    font-weight: 650;
    margin-bottom: 0.2rem;
  }
  .secondary {
    min-height: 44px;
    padding: 0.4rem 1rem;
    background: white;
    color: #172d46;
    border: 1px solid #b8c6d8;
    border-radius: 0.6rem;
    font-weight: 650;
    cursor: pointer;
  }
  .announced {
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .button {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0.4rem 1.1rem;
    background: #1b5982;
    color: white;
    border-radius: 0.6rem;
    text-decoration: none;
    font-weight: 650;
  }
  .skel {
    height: 1.1rem;
    border-radius: 0.4rem;
    background: #e8eef6;
    margin-bottom: 0.8rem;
  }
  .skel.short {
    width: 55%;
  }
</style>
