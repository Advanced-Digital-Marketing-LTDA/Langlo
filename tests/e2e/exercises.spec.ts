import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client/sqlite3';
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test';
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
  await withDatabase((client) => importContent(client, pkg));
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

/** Sign in through the rendered form and return the learner's id. */
async function signIn(page: Page, context: BrowserContext) {
  await context.setExtraHTTPHeaders({ 'x-forwarded-proto': 'http' });
  await page.goto(`${base}/login`);
  await page.getByLabel('Email').fill('exercises@example.test');
  await page.getByLabel('Password').fill('exercise-password-0000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`${base}/app`);
  const { user } = await (
    await page.request.get(`${base}/api/auth/get-session`)
  ).json();
  return user.id as string;
}

async function seedSession(userId: string) {
  await withDatabase((client) =>
    client.batch(
      [
        {
          sql: "INSERT INTO enrollments (id, owner_id, language, starting_level, explanation_language) VALUES ('exercise-enrollment', ?, 'fr', 'A1', 'en')",
          args: [userId]
        },
        {
          sql: "INSERT INTO study_sessions (id, owner_id, enrollment_id, language, mode) VALUES ('exercise-session', ?, 'exercise-enrollment', 'fr', 'practice')",
          args: [userId]
        }
      ],
      'write'
    )
  );
}

const storedAnswers = async (userId: string) =>
  (
    await withDatabase((client) =>
      client.execute({
        sql: "SELECT question_id, answer, evidence_kind FROM attempts WHERE owner_id = ? AND study_session_id = 'exercise-session' ORDER BY question_id",
        args: [userId]
      })
    )
  ).rows;

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
}

test('all four exercise formats render and submit without overflow', async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(40000);
  const userId = await signIn(page, context);
  await seedSession(userId);
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
      await feedback
        .getByText('Report a content issue', { exact: true })
        .click();
      await feedback
        .getByRole('button', { name: 'Send report', exact: true })
        .click();
      await expect(page.getByRole('status')).toContainText('Report saved');
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
  }

  expect(submissions).toHaveLength(4);
  expect(new URL(page.url()).searchParams.get('session')).toBe(
    'exercise-session'
  );
  await expect(page.getByRole('status')).toContainText(
    'You have answered every question'
  );
  expect(await storedAnswers(userId)).toEqual(
    exercises.map((exercise, index) => ({
      question_id: `fr-a1-001@1:q${index + 1}`,
      answer: exercise.answer,
      evidence_kind: 'independent'
    }))
  );
  await page.reload();
  await expect(page.getByRole('status')).toContainText(
    'You have answered every question'
  );
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

  await page.goto(`${base}/app/assessment/fr`);
  await page.getByRole('button', { name: 'Start assessment' }).click();
  await expect(
    page.getByRole('heading', { name: 'Grammar assessment', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Question 1 of 2', { exact: true })
  ).toBeVisible();
  expect(await page.content()).not.toContain('synthetic-secret-answer');
  await page.getByRole('button', { name: 'Not sure', exact: true }).click();
  await expect(
    page.getByText('Question 2 of 2', { exact: true })
  ).toBeVisible();
  const assessmentUrl = page.url();
  await page.reload();
  expect(await page.content()).not.toContain('synthetic-secret-answer');
  await expect(
    page.getByText('Question 2 of 2', { exact: true })
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
  await page
    .getByRole('textbox', { name: 'Your answer', exact: true })
    .fill('Nous sommes ici.');
  await page
    .getByRole('button', { name: 'Submit answer', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Assessment results', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Correct: 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Uncertain: 1', { exact: true })).toBeVisible();
  await expect(
    page.getByText('A1 topics to revisit', { exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('Uncertain: 1', { exact: true })).toBeVisible();
  await page.goto(`${base}/app/map`);
  await expect(
    page.getByRole('heading', { name: 'Grammar skill map', exact: true })
  ).toBeVisible();
  await expect(page.getByText(/^\s*◐\s*Practising\s*$/).first()).toBeVisible();
  const manual = page.getByRole('link', {
    name: 'Open Synthetic exercise lesson',
    exact: true
  });
  await manual.focus();
  await expect(manual).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic exercise lesson',
      exact: true
    })
  ).toBeVisible();
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
});
