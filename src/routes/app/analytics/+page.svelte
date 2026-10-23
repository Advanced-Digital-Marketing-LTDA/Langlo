<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  type SeriesKey =
    | 'flashcardsCompleted'
    | 'grammarCompleted'
    | 'flashcardsScheduled'
    | 'grammarScheduled';
  const series: {
    key: SeriesKey;
    label: string;
    color: string;
    scheduled: boolean;
  }[] = [
    {
      key: 'flashcardsCompleted',
      label: 'Flashcards completed',
      color: '#1d4ed8',
      scheduled: false
    },
    {
      key: 'grammarCompleted',
      label: 'Grammar completed',
      color: '#7c3aed',
      scheduled: false
    },
    {
      key: 'flashcardsScheduled',
      label: 'Flashcards scheduled',
      color: '#059669',
      scheduled: true
    },
    {
      key: 'grammarScheduled',
      label: 'Grammar scheduled',
      color: '#d97706',
      scheduled: true
    }
  ];
  const chartWidth = 960;
  const chartHeight = 320;
  const left = 58;
  const right = 24;
  const top = 18;
  const bottom = 48;
  const innerWidth = chartWidth - left - right;
  const innerHeight = chartHeight - top - bottom;
  const todayPosition = $derived(
    Math.max(
      0,
      data.days.findIndex((day) => day.flashcardsScheduled !== null)
    )
  );
  const maxValue = $derived(
    Math.max(
      1,
      ...data.days.flatMap((day) => series.map((item) => day[item.key] ?? 0))
    )
  );
  const chartX = (index: number) =>
    left +
    (data.days.length <= 1 ? 0 : (index / (data.days.length - 1)) * innerWidth);
  const chartY = (value: number) => top + (1 - value / maxValue) * innerHeight;
  const linePath = (key: SeriesKey) => {
    let move = true;
    return data.days
      .map((day, index) => {
        const value = day[key];
        if (value === null) {
          move = true;
          return '';
        }
        const command = move ? 'M' : 'L';
        move = false;
        return `${command}${chartX(index)},${chartY(value)}`;
      })
      .filter(Boolean)
      .join(' ');
  };
  // A path with one point draws nothing, so a series with a single value gets a marker.
  const singlePoint = (key: SeriesKey) => {
    const points = data.days.flatMap((day, index) => {
      const value = day[key];
      return value === null ? [] : [{ index, value }];
    });
    return points.length === 1 ? points[0] : null;
  };

  type StudyKey = 'flashcards' | 'grammar' | 'total';
  const studySeries: { key: StudyKey; label: string; color: string }[] = [
    { key: 'flashcards', label: 'Flashcards', color: '#1d4ed8' },
    { key: 'grammar', label: 'Grammar', color: '#7c3aed' },
    { key: 'total', label: 'Total', color: '#059669' }
  ];
  // Minutes to one decimal; null keeps "No Data" days out of the lines.
  const studyMinutes = $derived(
    data.studyTime.map((day) => {
      if (day.flashcardsSeconds === null || day.grammarSeconds === null)
        return { date: day.date, flashcards: null, grammar: null, total: null };
      const minutes = (seconds: number) => Math.round(seconds / 6) / 10;
      return {
        date: day.date,
        flashcards: minutes(day.flashcardsSeconds),
        grammar: minutes(day.grammarSeconds),
        total: minutes(day.flashcardsSeconds + day.grammarSeconds)
      };
    })
  );
  const hasStudyTime = $derived(studyMinutes.some((day) => day.total !== null));
  const maxStudyMinutes = $derived(
    Math.max(1, ...studyMinutes.map((day) => day.total ?? 0))
  );
  const studyX = (index: number) =>
    left +
    (studyMinutes.length <= 1
      ? 0
      : (index / (studyMinutes.length - 1)) * innerWidth);
  const studyY = (value: number) =>
    top + (1 - value / maxStudyMinutes) * innerHeight;
  const studyPath = (key: StudyKey) => {
    let move = true;
    return studyMinutes
      .map((day, index) => {
        const value = day[key];
        if (value === null) {
          move = true;
          return '';
        }
        const command = move ? 'M' : 'L';
        move = false;
        return `${command}${studyX(index)},${studyY(value)}`;
      })
      .filter(Boolean)
      .join(' ');
  };
  // Days with time that have no recorded neighbour draw nothing as a path.
  const studyPoints = (key: StudyKey) =>
    studyMinutes.flatMap((day, index) => {
      const value = day[key];
      const isolated =
        value !== null &&
        (studyMinutes[index - 1]?.[key] ?? null) === null &&
        (studyMinutes[index + 1]?.[key] ?? null) === null;
      return isolated ? [{ index, value }] : [];
    });
</script>

<svelte:head>
  <title>Review analytics · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Review analytics</h1>
<p>
  Completed counts come from recorded reviews. Scheduled counts use current due
  dates, including overdue work today. History starts with the earliest recorded
  review within the last 365 study days; scheduled dates extend through the
  farthest current due date, up to 365 days ahead. No future reviews are
  assumed.
</p>

<section class="panel" aria-labelledby="review-chart-title">
  <h2 id="review-chart-title">Completed and scheduled reviews</h2>
  <ul class="legend" aria-label="Chart series">
    {#each series as item (item.key)}
      <li>
        <span
          class:scheduled={item.scheduled}
          class="swatch"
          style={`--series-color: ${item.color}`}
          aria-hidden="true"
        ></span>
        {item.label}
      </li>
    {/each}
  </ul>
  <div class="chart-scroll">
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      role="img"
      aria-label="Actual completed reviews and currently scheduled reviews by study day"
      preserveAspectRatio="xMinYMin meet"
    >
      <title>Completed and scheduled review counts by study day</title>
      <desc>
        Separate lines show completed flashcard reviews, completed grammar
        reviews, currently scheduled flashcards, and currently scheduled grammar
        reviews. Scheduled work starts today; future activity is not generated.
      </desc>
      {#each [0, maxValue] as tick (tick)}
        <line
          x1={left}
          x2={chartWidth - right}
          y1={chartY(tick)}
          y2={chartY(tick)}
          class="grid-line"
        />
        <text
          x={left - 12}
          y={chartY(tick) + 4}
          text-anchor="end"
          class="axis-label">{tick}</text
        >
      {/each}
      <line
        x1={left}
        x2={chartWidth - right}
        y1={chartY(0)}
        y2={chartY(0)}
        class="axis-line"
      />
      <line
        x1={chartX(todayPosition)}
        x2={chartX(todayPosition)}
        y1={top}
        y2={chartY(0)}
        class="today-line"
      />
      {#each series as item (item.key)}
        <path
          d={linePath(item.key)}
          fill="none"
          stroke={item.color}
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-dasharray={item.scheduled ? '6 4' : undefined}
          vector-effect="non-scaling-stroke"
        />
        {@const point = singlePoint(item.key)}
        {#if point}
          <circle
            class="point"
            cx={chartX(point.index)}
            cy={chartY(point.value)}
            r="4"
            fill={item.color}
          />
        {/if}
      {/each}
      <text x={left} y={chartHeight - 12} class="axis-label"
        >{data.days[0]?.date}</text
      >
      {#if todayPosition > 0 && todayPosition < data.days.length - 1}
        <text
          x={chartX(todayPosition)}
          y={chartHeight - 12}
          text-anchor="middle"
          class="axis-label"
        >
          {data.days[todayPosition]?.date}
        </text>
      {/if}
      {#if data.days.length > 1}
        <text
          x={chartWidth - right}
          y={chartHeight - 12}
          text-anchor="end"
          class="axis-label"
        >
          {data.days.at(-1)?.date}
        </text>
      {/if}
    </svg>
  </div>
</section>

<section class="panel" aria-labelledby="review-table-title">
  <h2 id="review-table-title">Review history and scheduled reviews</h2>
  <div class="table-scroll">
    <table aria-label="Review history and scheduled reviews">
      <thead>
        <tr>
          <th rowspan="2" scope="col">Study day</th>
          <th colspan="3" scope="colgroup">Completed</th>
          <th colspan="3" scope="colgroup">Currently scheduled</th>
        </tr>
        <tr>
          <th scope="col">Flashcards</th>
          <th scope="col">Grammar</th>
          <th scope="col">Total</th>
          <th scope="col">Flashcards</th>
          <th scope="col">Grammar</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {#each data.days as day (day.date)}
          {@const completedTotal =
            day.flashcardsCompleted === null
              ? null
              : day.flashcardsCompleted + (day.grammarCompleted ?? 0)}
          {@const scheduledTotal =
            day.flashcardsScheduled === null
              ? null
              : day.flashcardsScheduled + (day.grammarScheduled ?? 0)}
          <tr>
            <th scope="row"><time datetime={day.date}>{day.date}</time></th>
            <td>{day.flashcardsCompleted ?? '—'}</td>
            <td>{day.grammarCompleted ?? '—'}</td>
            <td>{completedTotal ?? '—'}</td>
            <td>{day.flashcardsScheduled ?? '—'}</td>
            <td>{day.grammarScheduled ?? '—'}</td>
            <td>{scheduledTotal ?? '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<section class="panel" aria-labelledby="study-chart-title">
  <h2 id="study-chart-title">Study time</h2>
  <p>
    Active minutes on review, lesson and assessment pages. The timer stops after
    more than a minute without an action, and that pause is not counted.
  </p>
  {#if hasStudyTime}
    <ul class="legend" aria-label="Study time series">
      {#each studySeries as item (item.key)}
        <li>
          <span
            class="swatch"
            style={`--series-color: ${item.color}`}
            aria-hidden="true"
          ></span>
          {item.label}
        </li>
      {/each}
    </ul>
    <div class="chart-scroll">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label="Minutes studied by study day"
        preserveAspectRatio="xMinYMin meet"
      >
        <title>Minutes of flashcard, grammar and total study by study day</title
        >
        <desc>
          Separate lines show minutes spent on flashcards, minutes spent on
          grammar, and their total. Days without recorded study time have no
          point.
        </desc>
        {#each [0, maxStudyMinutes] as tick (tick)}
          <line
            x1={left}
            x2={chartWidth - right}
            y1={studyY(tick)}
            y2={studyY(tick)}
            class="grid-line"
          />
          <text
            x={left - 12}
            y={studyY(tick) + 4}
            text-anchor="end"
            class="axis-label">{tick}</text
          >
        {/each}
        <line
          x1={left}
          x2={chartWidth - right}
          y1={studyY(0)}
          y2={studyY(0)}
          class="axis-line"
        />
        {#each studySeries as item (item.key)}
          <path
            d={studyPath(item.key)}
            fill="none"
            stroke={item.color}
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
          {#each studyPoints(item.key) as point (point.index)}
            <circle
              class="point"
              cx={studyX(point.index)}
              cy={studyY(point.value)}
              r="4"
              fill={item.color}
            />
          {/each}
        {/each}
        <text x={left} y={chartHeight - 12} class="axis-label"
          >{studyMinutes[0]?.date}</text
        >
        {#if studyMinutes.length > 1}
          <text
            x={chartWidth - right}
            y={chartHeight - 12}
            text-anchor="end"
            class="axis-label"
          >
            {studyMinutes.at(-1)?.date}
          </text>
        {/if}
      </svg>
    </div>
  {:else}
    <p>No Data</p>
  {/if}
</section>

<section class="panel" aria-labelledby="study-table-title">
  <h2 id="study-table-title">Study time by day</h2>
  {#if hasStudyTime}
    <div class="table-scroll">
      <table aria-label="Study time by day">
        <thead>
          <tr>
            <th scope="col">Study day</th>
            <th scope="col">Flashcards (min)</th>
            <th scope="col">Grammar (min)</th>
            <th scope="col">Total (min)</th>
          </tr>
        </thead>
        <tbody>
          {#each studyMinutes as day (day.date)}
            <tr>
              <th scope="row"><time datetime={day.date}>{day.date}</time></th>
              <td>{day.flashcards ?? 'No Data'}</td>
              <td>{day.grammar ?? 'No Data'}</td>
              <td>{day.total ?? 'No Data'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p>No Data</p>
  {/if}
</section>

<style>
  .panel {
    padding: 1.25rem;
    margin-bottom: 1.25rem;
    background: white;
    border: 1px solid #d9e2ef;
    border-radius: 0.8rem;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.25rem;
    padding: 0;
    list-style: none;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .swatch {
    width: 1.15rem;
    border-top: 3px solid var(--series-color);
  }
  .swatch.scheduled {
    border-top-style: dashed;
  }
  .chart-scroll,
  .table-scroll {
    overflow: auto;
  }
  .chart-scroll svg {
    display: block;
    width: 100%;
    min-width: 42rem;
    height: auto;
  }
  .grid-line {
    stroke: #e5eaf1;
    stroke-width: 1;
  }
  .axis-line {
    stroke: #8796a8;
    stroke-width: 1;
  }
  .today-line {
    stroke: #8796a8;
    stroke-dasharray: 3 4;
    stroke-width: 1;
  }
  .axis-label {
    fill: #49617a;
    font:
      12px system-ui,
      sans-serif;
  }
  .table-scroll {
    max-height: 36rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
  }
  th,
  td {
    padding: 0.55rem 0.8rem 0.55rem 0;
    border-bottom: 1px solid #d9e2ef;
    white-space: nowrap;
  }
  thead {
    position: sticky;
    top: 0;
    background: white;
  }
  thead tr:first-child th {
    border-bottom: 0;
  }
</style>
