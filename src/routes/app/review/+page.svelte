<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { languageNames } from '../../../lib/languageNames';
  import { UNASSIGNED_LANGUAGE } from '../../../lib/review-due';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const label = (language: string) =>
    language === UNASSIGNED_LANGUAGE
      ? 'Unassigned'
      : (languageNames[language] ?? language);
  const count = (total: number, one: string, many: string) =>
    `${total} ${total === 1 ? one : many}`;
  const flashcardsHref = (language: string, due: 'overdue' | 'today') =>
    `/app/review/flashcards?language=${encodeURIComponent(language)}&due=${due}`;
</script>

<svelte:head>
  <title>Review · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Review</h1>
{#if form?.message}<p class="error-box" role="alert">{form.message}</p>{/if}
{#if !data.language}
  <p>You have no enrolled language tracks yet.</p>
  <p><a href="/app/settings">Choose a language</a></p>
{:else}
  <form class="languages" method="GET" aria-label="Review languages">
    {#each data.languages as language (language)}
      <button
        type="submit"
        name="language"
        value={language}
        aria-pressed={data.language === language}>{label(language)}</button
      >
    {/each}
  </form>

  {#if data.flashcards}
    <section aria-labelledby="review-flashcards">
      <h2 id="review-flashcards">Flashcards</h2>
      <div class="due">
        <div data-testid="flashcards-overdue">
          <h3>Overdue</h3>
          <p>{count(data.flashcards.overdue, 'card', 'cards')}</p>
          {#if data.flashcards.overdue}
            <a class="action" href={flashcardsHref(data.language, 'overdue')}
              >Review overdue flashcards</a
            >
          {/if}
        </div>
        <div data-testid="flashcards-today">
          <h3>Due today</h3>
          <p>{count(data.flashcards.today, 'card', 'cards')}</p>
          {#if data.flashcards.todayReady}
            <a class="action" href={flashcardsHref(data.language, 'today')}
              >Review today's flashcards</a
            >
          {:else if data.flashcards.nextDueAt}
            <p>Next card is due at {data.flashcards.nextDueAt}.</p>
          {/if}
        </div>
      </div>
    </section>
  {/if}

  {#if data.grammar}
    {@const grammar = data.grammar}
    <section aria-labelledby="review-grammar">
      <h2 id="review-grammar">Grammar</h2>
      <div class="due">
        {#each [{ due: 'overdue', title: 'Overdue', topics: grammar.overdue }, { due: 'today', title: 'Due today', topics: grammar.today }] as part (part.due)}
          <div data-testid={`grammar-${part.due}`}>
            <h3>{part.title}</h3>
            <p>{count(part.topics.length, 'topic', 'topics')}</p>
            {#if part.topics.some((topic) => topic.ready)}
              <form method="POST" action="?/grammar">
                <input type="hidden" name="language" value={data.language} />
                <input type="hidden" name="due" value={part.due} />
                <input
                  type="hidden"
                  name="submissionKey"
                  value={data.submissionKey}
                />
                <button type="submit" class="action"
                  >{part.due === 'overdue'
                    ? 'Review overdue grammar'
                    : "Review today's grammar"}</button
                >
              </form>
              {#if part.topics.filter((topic) => topic.ready).length > 5}
                <p>Each review covers up to five topics, oldest first.</p>
              {/if}
            {:else if part.due === 'today' && grammar.nextDueAt}
              <p>Next topic is due at {grammar.nextDueAt}.</p>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
{/if}

<style>
  .languages {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-block: 1rem;
  }
  .languages button {
    min-height: 44px;
    cursor: pointer;
  }
  .languages button[aria-pressed='true'] {
    background: #172d46;
    color: white;
    border-color: #172d46;
  }
  .due {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  }
  .action {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
</style>
