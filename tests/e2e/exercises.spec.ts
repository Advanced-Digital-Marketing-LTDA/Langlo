import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client/sqlite3';
import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test';
import { test } from './coverage-fixture';
import { importContent } from '../../src/lib/server/content-import';
import { approvedPackage } from '../fixtures/content-package';
import {
  createFixtureDatabase,
  disposeFixtureDatabase,
  reservePort,
  runNode,
  waitForLive
} from './fixture-server';

let server: ChildProcess;
let base = '';
let fixtureRoot = '';
let dbFile = '';
let learnerCookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;

async function withDatabase<T>(work: (client: Client) => Promise<T>) {
  const client = createClient({ url: `file://${dbFile}` });
  try {
    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute('PRAGMA busy_timeout = 5000');
    return await work(client);
  } finally {
    client.close();
  }
}

test.beforeAll(async () => {
  learnerCookies = undefined;
  const port = await reservePort();
  base = `http://127.0.0.1:${port}`;
  ({ fixtureRoot, dbFile } = createFixtureDatabase());
  const env = {
    ...process.env,
    APP_ENV: 'test',
    APP_ORIGIN: base,
    DATA_ENABLED: 'true',
    DATABASE_URL: `file://${dbFile}`,
    BETTER_AUTH_SECRET: 'e2e-only-auth-secret-0000000000000000',
    MAIL_TRANSPORT: 'capture',
    MAIL_CAPTURE_DIR: join(fixtureRoot, 'mail')
  };
  runNode(
    [
      'scripts/accounts-provision.ts',
      '--app',
      '--email',
      'exercises@example.test',
      '--name',
      'Exercise Learner'
    ],
    'exercise-password-0000',
    env
  );
  const pkg = approvedPackage();
  pkg.versions[0].lesson = {
    title: 'Synthetic exercise lesson',
    explanation: 'Practice the four exercise formats.',
    examples: [],
    references: []
  };
  pkg.versions[0].questions.push(
    {
      id: 'fr-a1-001@1:q3',
      format: 'translation',
      prompt: 'We are here.',
      answer: 'Nous sommes ici.'
    },
    {
      id: 'fr-a1-001@1:q4',
      format: 'correction',
      prompt: 'Je est ici.',
      answer: 'Je suis ici.'
    },
    {
      id: 'fr-a1-001@1:h1',
      format: 'typed-blank',
      prompt: 'Synthetic assessment item: Je ___ ici.',
      answer: 'synthetic-secret-answer',
      holdout: true
    }
  );
  pkg.versions[1].questions[0].holdout = true;
  pkg.versions.push({
    id: 'fr-a1-003@1',
    skillId: 'fr-a1-003',
    version: 1,
    review: 'approved',
    questions: [
      {
        id: 'fr-a1-003@1:q1',
        format: 'typed-blank',
        prompt: 'Synthetic assessment item for the third active skill.',
        answer: 'synthetic-third-answer',
        holdout: true
      }
    ]
  });
  await withDatabase((client) => importContent(client, pkg));
  await withDatabase((client) =>
    client.execute("UPDATE skills SET retired_at = 1 WHERE id = 'fr-articles'")
  );
  server = spawn(process.execPath, ['build'], {
    env: {
      ...env,
      HOST: '127.0.0.1',
      PORT: String(port),
      ORIGIN: base,
      PROTOCOL_HEADER: 'x-forwarded-proto'
    },
    stdio: 'ignore'
  });
  await waitForLive(base);
});

test.afterAll(async () => {
  server?.kill();
  if (server && server.exitCode === null && server.signalCode === null)
    await new Promise<void>((resolve) => server.once('exit', resolve));
  await disposeFixtureDatabase(fixtureRoot, dbFile);
});

type Exercise = {
  format: string;
  instruction: string;
  answer: string;
};

const exercises: Exercise[] = [
  {
    format: 'multiple-choice',
    instruction: 'Choose the correct answer.',
    answer: 'suis'
  },
  {
    format: 'typed-blank',
    instruction: 'Type the missing word or words.',
    answer: 'es'
  },
  {
    format: 'translation',
    instruction: 'Translate the sentence.',
    answer: 'Nous sommes ici.'
  },
  {
    format: 'correction',
    instruction: 'Rewrite the sentence with the mistake corrected.',
    answer: 'Je suis ici.'
  }
];

/** Sign in through the form once, then reuse this synthetic fixture session. */
async function signIn(page: Page, context: BrowserContext) {
  await context.setExtraHTTPHeaders({ 'x-forwarded-proto': 'http' });
  if (learnerCookies) {
    await context.addCookies(learnerCookies);
    await page.goto(`${base}/app`);
  } else {
    await page.goto(`${base}/login`);
    await page.getByLabel('Email').fill('exercises@example.test');
    await page.getByLabel('Password').fill('exercise-password-0000');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page).toHaveURL(`${base}/app`);
  learnerCookies ??= await context.cookies();
  const { user } = await (
    await page.request.get(`${base}/api/auth/get-session`)
  ).json();
  return user.id as string;
}

async function seedSession(
  userId: string,
  sessionId = 'exercise-session',
  retentionPolicyVersion: string | null = null
) {
  await withDatabase(async (client) => {
    await client.execute({
      sql: "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES (?, ?, 'fr', 'A1', 'en') ON CONFLICT(owner_id, language) DO NOTHING",
      args: [`exercise-enrollment-${userId}`, userId]
    });
    const enrollment = await client.execute({
      sql: 'SELECT id FROM enrollments WHERE owner_id = ? AND language = ?',
      args: [userId, 'fr']
    });
    await client.execute({
      sql: "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode, grammar_retention_policy_version) VALUES (?, ?, ?, 'fr', 'practice', ?)",
      args: [
        sessionId,
        userId,
        String(enrollment.rows[0]?.id),
        retentionPolicyVersion
      ]
    });
  });
}

const storedAnswers = async (
  userId: string,
  studySessionId = 'exercise-session'
) =>
  (
    await withDatabase((client) =>
      client.execute({
        sql: 'SELECT question_id, answer, evidence_kind FROM attempts WHERE owner_id = ? AND study_session_id = ? ORDER BY question_id',
        args: [userId, studySessionId]
      })
    )
  ).rows;

async function startRefreshScenario(page: Page, context: BrowserContext) {
  const userId = await signIn(page, context);
  const studySessionId = `refresh-session-${randomUUID()}`;
  await seedSession(userId, studySessionId);
  const currentVersion = await (
    await page.request.get(`${base}/_app/version.json`)
  ).json();
  await page.goto('about:blank');
  await page.clock.install();
  let documentRequests = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.resourceType() === 'document')
      documentRequests += 1;
  });
  let versionChecks = 0;
  let reportUpdate = false;
  await page.route('**/version.json', (route) => {
    versionChecks += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: reportUpdate
          ? 'next-synthetic-version'
          : currentVersion.version
      })
    });
  });
  await page.goto(
    `${base}/app/learn/fr/lesson/fr-a1-001?session=${studySessionId}`
  );
  return {
    userId,
    studySessionId,
    documentRequests: () => documentRequests,
    versionChecks: () => versionChecks,
    reportUpdate: () => {
      reportUpdate = true;
    }
  };
}

async function detectUpdateAfterFiveMinutes(
  page: Page,
  scenario: Awaited<ReturnType<typeof startRefreshScenario>>
) {
  const firstCheck = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith('/version.json'),
    { timeout: 5000 }
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await firstCheck;
  await new Promise((resolve) => setTimeout(resolve, 25));
  const initialChecks = scenario.versionChecks();
  scenario.reportUpdate();
  await page.clock.fastForward(299_999);
  expect(scenario.versionChecks()).toBe(initialChecks);
  const versionResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith('/version.json'),
    { timeout: 5000 }
  );
  await page.clock.fastForward(1);
  await versionResponse;
}

async function setSessionState(
  userId: string,
  studySessionId: string,
  state: 'active' | 'paused'
) {
  await withDatabase((client) =>
    client.execute({
      sql: 'UPDATE study_sessions SET state = ?, paused_at = ? WHERE id = ? AND owner_id = ?',
      args: [
        state,
        state === 'paused' ? Date.now() : null,
        studySessionId,
        userId
      ]
    })
  );
}

/** Exercise the JSON boundary with the same authenticated browser session. */
async function expectBlankAttemptsRefused(page: Page) {
  for (const answer of ['', ' \n\t\u00a0']) {
    const response = await page.request.post(`${base}/app/api/attempts`, {
      headers: { origin: base },
      data: {
        studySessionId: 'exercise-session',
        questionId: 'fr-a1-001@1:q1',
        submissionKey: 'empty-api-attempt',
        evidenceKind: 'independent',
        answer
      }
    });
    expect(response.status()).toBe(400);
  }
}

async function expectUnicodeLimit(page: Page, field: Locator, submit: Locator) {
  const atLimit = '😀'.repeat(4096);
  await field.fill('');
  await page.keyboard.insertText(atLimit);
  await expect(field).toHaveValue(atLimit);
  await page.keyboard.insertText('😀');
  await submit.click();
  await expect(page.getByRole('alert')).toContainText(
    'Your answer is too long.'
  );
  await expect(field).toHaveValue(`${atLimit}😀`);
}

async function selectChoiceByKeyboard(
  page: Page,
  exercise: Exercise,
  answerControl: Locator,
  submit: Locator
) {
  const first = answerControl.getByRole('radio', {
    name: exercise.answer,
    exact: true
  });
  const second = answerControl.getByRole('radio', {
    name: 'es',
    exact: true
  });
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(second).toBeFocused();
  await expect(second).toBeChecked();
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
  await expect(first).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(first).toBeFocused();
}

/** Fill the current exercise the way a learner would, accents included. */
async function fillAnswer(
  page: Page,
  exercise: Exercise,
  answerControl: Locator
) {
  const submit = page.getByRole('button', {
    name: 'Submit answer',
    exact: true
  });
  if (exercise.format === 'multiple-choice') {
    await selectChoiceByKeyboard(page, exercise, answerControl, submit);
  } else {
    const field = answerControl;
    await expect(field).toHaveJSProperty(
      'tagName',
      exercise.format === 'typed-blank' ? 'INPUT' : 'TEXTAREA'
    );
    await expectUnicodeLimit(page, field, submit);
    await field.fill('ee');
    const accents = page.getByRole('group', {
      name: 'Accented letters',
      exact: true
    });
    await page.keyboard.press('Tab');
    await expect(
      accents.getByRole('button', { name: 'à', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(field).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    for (const letter of ['à', 'â', 'ç', 'é']) {
      await page.keyboard.press('Tab');
      await expect(
        accents.getByRole('button', { name: letter, exact: true })
      ).toBeFocused();
    }
    await page.keyboard.press('Space');
    await expect(field).toHaveValue('eée');
    await expect(field).toBeFocused();
    await expect(field).toHaveJSProperty('selectionStart', 2);
    await expect(field).toHaveJSProperty('selectionEnd', 2);
    await field.fill(exercise.answer);
    const accentButtons = accents.getByRole('button');
    for (const button of await accentButtons.all()) {
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(submit).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(accentButtons.last()).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
}

/** The page fits the viewport and every control is a usable touch target. */
async function expectUsableLayout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  const controls = page
    .locator('form')
    .locator(
      'input:not([type="hidden"]):not([type="radio"]), textarea, button, label.option'
    );
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
}

async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  format: string
) {
  const screenshot = testInfo.outputPath(`${format}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach(`${format}-${testInfo.project.name}`, {
    path: screenshot,
    contentType: 'image/png'
  });
}

/** Submit blank first (refused, nothing sent), then answer and submit. */
async function answerExercise(
  page: Page,
  testInfo: TestInfo,
  userId: string,
  index: number
) {
  const exercise = exercises[index];
  const exerciseGroup = page.getByRole('group', {
    name: exercise.instruction,
    exact: true
  });
  await expect(exerciseGroup).toBeVisible();
  await expect(exerciseGroup.locator('legend')).toHaveText(
    exercise.instruction
  );
  const answerControl =
    exercise.format === 'multiple-choice'
      ? exerciseGroup.getByRole('radiogroup')
      : exerciseGroup.getByRole('textbox', {
          name: 'Your answer',
          exact: true
        });
  if (exercise.format === 'multiple-choice')
    await expect(answerControl).toHaveAccessibleName(exercise.instruction);
  await expect(answerControl).not.toHaveAttribute('aria-describedby', /.+/);
  await expect(answerControl).toHaveAccessibleDescription('');
  await expect(
    page.getByText(`Question ${index + 1} of 4`, { exact: true })
  ).toBeVisible();
  const submit = page.getByRole('button', {
    name: 'Submit answer',
    exact: true
  });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Enter an answer');
  await expect(answerControl).toHaveAttribute(
    'aria-describedby',
    `exercise-problem-fr-a1-001@1:q${index + 1}`
  );
  await expect(answerControl).toHaveAccessibleDescription(
    'Enter an answer before you submit.'
  );
  await expect(submit).toBeEnabled();
  expect(await storedAnswers(userId)).toHaveLength(index);
  await fillAnswer(page, exercise, answerControl);
  await expectUsableLayout(page);
  await attachScreenshot(page, testInfo, exercise.format);
  await page.keyboard.press('Enter');
  await expect.poll(() => storedAnswers(userId)).toHaveLength(index + 1);
  const feedback = page.getByRole('region', { name: 'Practice feedback' });
  await expect(feedback).toContainText('Correct');
  await feedback.getByRole('button', { name: 'Good', exact: true }).click();
  if (index === 0) await attachScreenshot(page, testInfo, 'grammar-rating');
}

async function rateAssessmentResults(page: Page) {
  const ratings = page.getByRole('button', { name: 'Good', exact: true });
  await expect(ratings).toHaveCount(2);
  await ratings.first().click();
  await expect(
    page.getByText('You rated this good.', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Good', exact: true }).click();
  await expect(
    page.getByText('You rated this good.', { exact: true })
  ).toHaveCount(2);
}

async function completeAssessmentAnswers(page: Page) {
  await page
    .getByRole('textbox', { name: 'Your answer', exact: true })
    .fill('Nous sommes ici.');
  await page
    .getByRole('button', { name: 'Submit answer', exact: true })
    .click();
  await expect(
    page.getByText('Question 3 of 3', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Your answer', exact: true })
    .fill('synthetic-third-answer');
  await page
    .getByRole('button', { name: 'Submit answer', exact: true })
    .click();
}

async function assessAllActiveSkills(page: Page, userId: string) {
  await page.goto(`${base}/app/assessment/fr`);
  await expect(page.locator('h1')).toHaveText('Assess FR grammar');
  await expect(
    page.getByText(
      'You will answer one unseen question for each active skill across all levels in this language.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByText(/Choosing Not sure five times/)).toBeVisible();
  await page.getByRole('button', { name: 'Start assessment' }).click();
  await expect(
    page.getByRole('heading', { name: 'Grammar assessment', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Question 1 of 3', { exact: true })
  ).toBeVisible();
  expect(await page.content()).not.toContain('synthetic-secret-answer');
  await page.getByRole('button', { name: 'Not sure', exact: true }).click();
  await expect(
    page.getByText('Question 2 of 3', { exact: true })
  ).toBeVisible();
  const assessmentUrl = page.url();
  await page.reload();
  expect(await page.content()).not.toContain('synthetic-secret-answer');
  await expect(
    page.getByText('Question 2 of 3', { exact: true })
  ).toBeVisible();
  const premature = await page.request.get(`${assessmentUrl}/results`);
  expect(premature.status()).toBe(409);
  const partial = await withDatabase((client) =>
    client.execute({
      sql: "SELECT a.id FROM attempts a JOIN study_sessions s ON s.id = a.study_session_id WHERE a.owner_id = ? AND s.mode = 'assessment'",
      args: [userId]
    })
  );
  const api = await page.request.get(
    `${base}/app/api/attempts/${partial.rows[0].id}`
  );
  expect((await api.json()).attempt.evaluations).toEqual([]);
  await completeAssessmentAnswers(page);
  await expect(
    page.getByRole('heading', { name: 'Assessment results', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Correct: 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Uncertain: 1', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Questions not reached: 0', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('A1 topics to revisit', { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('Uncertain: 1', { exact: true })).toBeVisible();
  await rateAssessmentResults(page);
}

test('restores the map position after returning from a lesson', async ({
  page,
  context
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const userId = await signIn(page, context);
  await seedSession(userId, 'map-scroll-session');
  await page.goto(`${base}/app/map?language=fr&skill=fr-a1-003`);
  const viewport = page.getByRole('region', { name: /FR topic map/u });
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await page.locator('#map-skill-fr-a1-001').click();
  await viewport.evaluate((element) => {
    element.scrollLeft = Math.min(
      200,
      element.scrollWidth - element.clientWidth
    );
  });
  await expect
    .poll(async () => Number(new URL(page.url()).searchParams.get('x')))
    .toBeGreaterThan(0);
  await page.getByRole('link', { name: 'Open lesson' }).click();
  await page.getByRole('link', { name: 'Back to skill map' }).click();
  await expect(page).toHaveURL(/\/app\/map\?.*x=\d+/u);
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await viewport.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await expect.poll(() => new URL(page.url()).searchParams.get('x')).toBe('0');
  await page.getByRole('link', { name: 'Open lesson' }).click();
  await page.getByRole('link', { name: 'Back to skill map' }).click();
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollLeft))
    .toBe(0);
});

test('preserves map context through native answer, retry, and report posts', async ({
  browser
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const scripts = await context.newCDPSession(page);
  await scripts.send('Emulation.setScriptExecutionDisabled', { value: true });
  const returnTo = '/app/map?language=fr&skill=fr-a1-001&status=weak&x=80&y=0';
  try {
    await context.setExtraHTTPHeaders({ 'x-forwarded-proto': 'http' });
    await page.goto(`${base}/signup`);
    await page.getByLabel('Name').fill('Native Map Learner');
    await page.getByLabel('Email').fill('native-map@example.test');
    await page.getByLabel('Password').fill('native-map-password-0000');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(`${base}/app`);
    const { user } = await (
      await page.request.get(`${base}/api/auth/get-session`)
    ).json();
    await seedSession(user.id as string, 'native-map-session');
    await page.goto(
      `${base}/app/learn/fr/lesson/fr-a1-001?session=native-map-session&returnTo=${encodeURIComponent(returnTo)}`
    );
    const back = page.getByRole('link', { name: 'Back to skill map' });
    await expect(back).toHaveAttribute('href', returnTo);
    await page.getByRole('radio', { name: 'es', exact: true }).check();
    await page
      .getByRole('button', { name: 'Submit answer', exact: true })
      .click();
    await expect(back).toHaveAttribute('href', returnTo);
    const feedback = page.getByRole('region', { name: 'Practice feedback' });
    await feedback.getByText('Try this question again (assisted)').click();
    await feedback.getByRole('radio', { name: 'suis', exact: true }).check();
    await feedback
      .getByRole('button', { name: 'Submit assisted retry' })
      .click();
    await expect(back).toHaveAttribute('href', returnTo);
    await feedback.getByText('Report a content issue', { exact: true }).click();
    await feedback.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByRole('status')).toContainText('Report saved');
    await expect(back).toHaveAttribute('href', returnTo);
    await page.goto(
      `${base}/app/learn/fr/lesson/fr-a1-001?returnTo=${encodeURIComponent(returnTo)}`
    );
    await page.getByText('Report a content issue', { exact: true }).click();
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByRole('status')).toContainText('Report saved');
    await expect(back).toHaveAttribute('href', returnTo);
  } finally {
    await context.close();
  }
});

test('opens a dashboard topic in its language when another language sorts first', async ({
  page,
  context
}) => {
  const userId = await signIn(page, context);
  await seedSession(userId, 'dashboard-map-session');
  await withDatabase((client) =>
    client.execute({
      sql: "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('dashboard-en', ?, 'en', 'A1', 'en')",
      args: [userId]
    })
  );
  try {
    await page.goto(`${base}/app`);
    await page
      .getByRole('region', { name: 'FR dashboard' })
      .getByRole('link', { name: 'Synthetic exercise lesson', exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/map\?language=fr&skill=fr-a1-001/u);
    await expect(
      page.getByRole('complementary', {
        name: 'Synthetic exercise lesson details'
      })
    ).toBeVisible();
  } finally {
    await withDatabase((client) =>
      client.execute("DELETE FROM enrollments WHERE id = 'dashboard-en'")
    );
  }
});

async function observeMapTimer(page: Page) {
  await page.evaluate(() => {
    const schedule = window.setTimeout;
    const cancel = window.clearTimeout;
    let timer: number | undefined;
    window.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      const id = schedule(handler, delay, ...args);
      if (delay === 180) {
        timer = id;
        Reflect.set(window, 'mapTimerPending', true);
      }
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = (id) => {
      if (id === timer) Reflect.set(window, 'mapTimerPending', false);
      cancel(id);
    };
  });
}

test('does not rewrite the lesson URL after leaving a freshly scrolled map', async ({
  page,
  context
}) => {
  const userId = await signIn(page, context);
  await seedSession(userId, 'map-fast-exit-session');
  await page.goto(`${base}/app/map`);
  await page.locator('#map-skill-fr-a1-001').click();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.evaluate(() => Reflect.set(window, 'mapDocumentMarker', true));
  await observeMapTimer(page);
  await page
    .getByRole('region', { name: /FR topic map/u })
    .evaluate((element) => {
      element.scrollLeft = 50;
      element.dispatchEvent(new Event('scroll'));
    });
  expect(
    await page.evaluate(() => Reflect.get(window, 'mapTimerPending'))
  ).toBe(true);
  await page
    .getByRole('link', { name: 'Open lesson', exact: true })
    .evaluate((link: HTMLAnchorElement) => link.click());
  await page.clock.runFor(50);
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic exercise lesson',
      exact: true
    })
  ).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, 'mapDocumentMarker'))
  ).toBe(true);
  expect(
    await page.evaluate(() => Reflect.get(window, 'mapTimerPending'))
  ).toBe(false);
  await page.clock.fastForward(500);
  await expect(page).toHaveURL(/\/app\/learn\/fr\/lesson\/fr-a1-001\?/u);
});

async function exploreSkillMap(page: Page) {
  await page.goto(`${base}/app/map`);
  await expect(
    page.getByRole('heading', { name: 'Grammar skill map', exact: true })
  ).toBeVisible();
  await expect(page.getByText(/^\s*◐\s*Practising\s*$/).first()).toBeVisible();
  const manual = page
    .getByRole('button', { name: /Synthetic exercise lesson/ })
    .first();
  await manual.focus();
  await expect(manual).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('complementary', {
      name: 'Synthetic exercise lesson details'
    })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'List view' })).toBeVisible();
  // On phones the topic sheet intentionally overlays the map controls.
  // Dismiss it through the visible control before changing the map view.
  await page.getByRole('button', { name: 'Close topic details' }).click();
  await expect(
    page.getByRole('complementary', {
      name: 'Synthetic exercise lesson details',
      exact: true
    })
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: /FR topic map/u })
      .getByRole('button', { name: /Synthetic exercise lesson/ })
  ).toBeFocused();
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(
    page.getByRole('list').getByText('Synthetic exercise lesson')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Map', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await manual.click();
  await page.getByRole('link', { name: 'Open lesson' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic exercise lesson',
      exact: true
    })
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to skill map' }).click();
  await expect(page).toHaveURL(/\/app\/map\?.*skill=fr-a1-001/);
  await page.getByRole('button', { name: 'Practise this topic' }).click();
  await expect(page).toHaveURL(/\/app\/learn\/fr\/lesson\/fr-a1-001\?session=/);
  await expect(
    page.getByRole('heading', { name: 'Synthetic exercise lesson' })
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to skill map' }).click();
}

async function exerciseRetryAndReport(page: Page, userId: string) {
  const feedback = page.getByRole('region', { name: 'Practice feedback' });
  await feedback.getByText('Try this question again (assisted)').click();
  await feedback
    .getByRole('button', { name: 'Submit assisted retry', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Submit answer', exact: true })
    .click();
  const ids = await page
    .getByRole('alert')
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  await feedback.getByText('Try this question again (assisted)').click();
  await feedback.getByText('Report a content issue', { exact: true }).click();
  await feedback
    .getByRole('button', { name: 'Send report', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Report saved' })
  ).toContainText('Report saved');
  const exactReport = await withDatabase((client) =>
    client.execute({
      sql: 'SELECT question_id, content_version_id FROM content_reports WHERE owner_id = ? ORDER BY created_at, rowid LIMIT 1',
      args: [userId]
    })
  );
  expect(exactReport.rows[0]).toMatchObject({
    question_id: 'fr-a1-001@1:q1',
    content_version_id: 'fr-a1-001@1'
  });
  await page.reload();
}

async function verifyCompletedExercises(
  page: Page,
  userId: string,
  submissions: string[]
) {
  expect(submissions).toHaveLength(4);
  expect(new URL(page.url()).searchParams.get('session')).toBe(
    'exercise-session'
  );
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'You have answered every question' })
  ).toContainText('You have answered every question');
  expect(await storedAnswers(userId)).toEqual(
    exercises.map((exercise, index) => ({
      question_id: `fr-a1-001@1:q${index + 1}`,
      answer: exercise.answer,
      evidence_kind: 'independent'
    }))
  );
  await page.reload();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'You have answered every question' })
  ).toContainText('You have answered every question');
  const feedback = page.getByRole('region', { name: 'Practice feedback' });
  await expect(feedback).toContainText('Correct');
  await feedback.getByText('Try this question again (assisted)').click();
  await feedback
    .getByRole('textbox', { name: 'Your answer', exact: true })
    .fill('Je suis ici.');
  await feedback.getByRole('button', { name: 'Submit assisted retry' }).click();
  await expect(feedback).toContainText(
    'Assisted retry — this does not add independent grammar evidence.'
  );
  await page.reload();
  await expect(feedback).toContainText('Assisted retry');
}

async function expectProgressAndHome(page: Page) {
  await page.goto(`${base}/app/progress`);
  await expect(
    page.getByRole('heading', { name: 'Grammar progress', exact: true })
  ).toBeVisible();
  await expect(page.getByText(/Policy grammar-1/).first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.goto(`${base}/app`);
  await expect(
    page.getByRole('heading', { name: /^Welcome back,/ })
  ).toBeVisible();
  await expect(page.getByText(/Signed in as /)).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Study navigation' })
      .getByRole('link', {
        name: 'Home',
        exact: true
      })
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('heading', { name: 'Grammar mastery', exact: true })
  ).toBeVisible();
  await expect(page.getByText(/^\s*◐\s*Practising\s*$/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Full skill map', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/map(?:\?.*)?$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
}

async function reportLessonIssue(page: Page) {
  await page.goto(`${base}/app/learn/fr/lesson/fr-a1-001`);
  await page.getByText('Report a content issue', { exact: true }).click();
  await page.getByLabel('What needs attention?').selectOption('unclear');
  await page.getByLabel('Comment (optional)').fill('x'.repeat(1001));
  await page.getByRole('button', { name: 'Send report', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1000');
  await page.getByText('Report a content issue', { exact: true }).click();
  await page
    .getByLabel('Comment (optional)')
    .fill('<script>synthetic correction report</script>');
  await page.getByRole('button', { name: 'Send report', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Report saved');
  await page.getByRole('link', { name: 'Your reports', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your content reports', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('<script>synthetic correction report</script>', {
      exact: true
    })
  ).toBeVisible();
  await expect(page.getByText('fr-a1-001@1', { exact: true })).toHaveCount(2);
  await expect(
    page.getByText('fr-a1-001@1', { exact: true }).first()
  ).toBeVisible();
}

test('all four exercise formats render and submit without overflow', async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(40000);
  const userId = await signIn(page, context);
  await seedSession(userId, 'exercise-session', 'grammar-fsrs-1');
  await expectBlankAttemptsRefused(page);
  expect(await storedAnswers(userId)).toEqual([]);

  await page.goto(
    `${base}/app/learn/fr/lesson/fr-a1-001?session=exercise-session`
  );
  const submissions: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('/lesson/') &&
      request.url().includes('/answer')
    )
      submissions.push(request.url());
  });
  for (const index of exercises.keys()) {
    await answerExercise(page, testInfo, userId, index);
    if (index === 0) {
      await exerciseRetryAndReport(page, userId);
    }
  }

  await verifyCompletedExercises(page, userId, submissions);

  await assessAllActiveSkills(page, userId);
  await exploreSkillMap(page);
  await expectProgressAndHome(page);
  await reportLessonIssue(page);
});

test('waits for a saved answer before refreshing to the detected app version', async ({
  page,
  context
}) => {
  test.setTimeout(40000);
  const scenario = await startRefreshScenario(page, context);
  const { userId, studySessionId } = scenario;
  expect(await storedAnswers(userId, studySessionId)).toHaveLength(0);
  await expect(page.locator('input[name="retryAttemptId"]')).toHaveCount(0);
  const answer = page.getByRole('radio', { name: 'suis', exact: true });
  await answer.check();
  await detectUpdateAfterFiveMinutes(page, scenario);
  await expect(answer).toBeChecked();
  expect(scenario.documentRequests()).toBe(1);

  await setSessionState(userId, studySessionId, 'paused');
  const submit = page.getByRole('button', {
    name: 'Submit answer',
    exact: true
  });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText(
    'This session is paused or finished.'
  );
  await expect(answer).toBeChecked();
  await expect(page.locator('input[name="retryAttemptId"]')).toHaveCount(0);
  expect(await storedAnswers(userId, studySessionId)).toHaveLength(0);
  expect(scenario.documentRequests()).toBe(1);

  await setSessionState(userId, studySessionId, 'active');
  await submit.click();
  await expect
    .poll(() => scenario.documentRequests(), { timeout: 5000 })
    .toBe(2);
  await expect(
    page.getByText('Question 2 of 4', { exact: true })
  ).toBeVisible();
  expect(await storedAnswers(userId, studySessionId)).toEqual([
    expect.objectContaining({
      question_id: 'fr-a1-001@1:q1',
      answer: 'suis'
    })
  ]);
  const version = await withDatabase((client) =>
    client.execute({
      sql: 'SELECT content_version_id FROM attempts WHERE owner_id = ? AND study_session_id = ?',
      args: [userId, studySessionId]
    })
  );
  expect(version.rows).toEqual([{ content_version_id: 'fr-a1-001@1' }]);
  const session = await (
    await page.request.get(`${base}/api/auth/get-session`)
  ).json();
  expect(session.user.id).toBe(userId);
});

test('releases the refresh block when a dirty exercise is destroyed', async ({
  page,
  context
}) => {
  test.setTimeout(40000);
  const scenario = await startRefreshScenario(page, context);
  await page.getByRole('radio', { name: 'suis', exact: true }).check();
  await detectUpdateAfterFiveMinutes(page, scenario);
  expect(scenario.documentRequests()).toBe(1);

  await page.getByRole('link', { name: 'Your reports', exact: true }).click();
  await expect
    .poll(() => scenario.documentRequests(), { timeout: 5000 })
    .toBe(2);
  await expect(
    page.getByRole('heading', { name: 'Your content reports', exact: true })
  ).toBeVisible();
});

test('keeps refresh blocked until every mounted exercise is clear', async ({
  page,
  context
}) => {
  test.setTimeout(40000);
  const scenario = await startRefreshScenario(page, context);
  const { userId, studySessionId } = scenario;
  await page.getByRole('radio', { name: 'suis', exact: true }).check();
  await page
    .getByRole('button', { name: 'Submit answer', exact: true })
    .click();
  const feedback = page.getByRole('region', { name: 'Practice feedback' });
  await feedback.getByText('Try this question again (assisted)').click();
  await expect(page.locator('input[name="studySessionId"]')).toHaveCount(2);
  await feedback.getByRole('radio', { name: 'suis', exact: true }).check();
  const currentAnswer = page.getByRole('textbox', {
    name: 'Your answer',
    exact: true
  });
  await currentAnswer.fill('es');
  await detectUpdateAfterFiveMinutes(page, scenario);
  expect(scenario.documentRequests()).toBe(1);

  await feedback
    .getByRole('button', { name: 'Submit assisted retry', exact: true })
    .click();
  await expect(
    feedback.getByRole('radio', { name: 'suis', exact: true })
  ).not.toBeChecked();
  await expect(currentAnswer).toHaveValue('es');
  expect(scenario.documentRequests()).toBe(1);

  await page
    .getByRole('button', { name: 'Submit answer', exact: true })
    .click();
  await expect
    .poll(() => scenario.documentRequests(), { timeout: 5000 })
    .toBe(2);
  await expect(
    page.getByText('Question 3 of 4', { exact: true })
  ).toBeVisible();
  const answers = await storedAnswers(userId, studySessionId);
  expect(
    answers
      .filter(({ question_id }) => question_id === 'fr-a1-001@1:q1')
      .map(({ answer }) => answer)
  ).toEqual(['suis', 'suis']);
  expect(answers).toContainEqual(
    expect.objectContaining({ question_id: 'fr-a1-001@1:q2', answer: 'es' })
  );
});
