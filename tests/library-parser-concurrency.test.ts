import { afterEach, describe, expect, it, vi } from 'vitest';

const { workers, spawn, FakeWorker } = vi.hoisted(() => {
  const workers: { emit: (event: string, value: unknown) => void }[] = [];
  const spawn = { failNext: false };
  class FakeWorker {
    listeners = new Map<string, ((value: unknown) => void)[]>();

    constructor() {
      if (spawn.failNext) {
        spawn.failNext = false;
        throw new Error('synthetic spawn failure');
      }
      workers.push(this);
    }

    once(event: string, listener: (value: unknown) => void) {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        listener
      ]);
    }

    emit(event: string, value: unknown) {
      for (const listener of this.listeners.get(event) ?? []) listener(value);
    }

    terminate() {
      setImmediate(() => this.emit('exit', 1));
      return Promise.resolve(1);
    }
  }
  return { workers, spawn, FakeWorker };
});

vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }));

import { parseLibraryDocument } from '../src/lib/server/library';

afterEach(() => {
  vi.useRealTimers();
  workers.length = 0;
  spawn.failNext = false;
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Two parses that must both start, which proves both parser slots are free. */
async function expectBothSlotsFree() {
  const file = () => new File(['synthetic'], 'book.pdf');
  const next = [
    parseLibraryDocument(file(), 'fr'),
    parseLibraryDocument(file(), 'fr')
  ];
  await tick();
  const started = workers.slice(-2);
  expect(started).toHaveLength(2);
  started[0].emit('message', { text: 'Bonjour.' });
  started[1].emit('message', { text: 'Bonsoir.' });
  await expect(Promise.all(next)).resolves.toMatchObject([
    { content: 'Bonjour.' },
    { content: 'Bonsoir.' }
  ]);
  await tick();
}

describe('Library parser concurrency', () => {
  it.each([0, 1])('rejects worker exit %s without a result', async (code) => {
    let failure: unknown;
    const parsed = parseLibraryDocument(
      new File(['synthetic'], 'book.pdf'),
      'fr'
    ).catch((error: unknown) => {
      failure = error;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    workers[0].emit('exit', code);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(failure).toMatchObject({ code: 'INVALID_LIBRARY_DOCUMENT' });
    await parsed;
  });

  it('releases parser capacity after a worker error', async () => {
    const file = () => new File(['synthetic'], 'book.pdf');
    const first = parseLibraryDocument(file(), 'fr');
    const rejected = expect(first).rejects.toMatchObject({
      code: 'INVALID_LIBRARY_DOCUMENT'
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    workers[0].emit('error', new Error('synthetic worker failure'));
    workers[0].emit('exit', 1);
    await rejected;
    const next = [
      parseLibraryDocument(file(), 'fr'),
      parseLibraryDocument(file(), 'fr')
    ];
    await new Promise<void>((resolve) => setImmediate(resolve));
    workers[1].emit('message', { text: 'Bonjour.' });
    workers[2].emit('message', { text: 'Bonsoir.' });
    await expect(Promise.all(next)).resolves.toMatchObject([
      { content: 'Bonjour.' },
      { content: 'Bonsoir.' }
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it('times out stalled workers and restores both parser slots', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const file = () => new File(['synthetic'], 'book.pdf');
    const first = parseLibraryDocument(file(), 'fr');
    const second = parseLibraryDocument(file(), 'fr');
    const rejected = Promise.all(
      [first, second].map((parsed) =>
        expect(parsed).rejects.toMatchObject({ code: 'LIBRARY_PARSE_TIMEOUT' })
      )
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const next = [
      parseLibraryDocument(file(), 'fr'),
      parseLibraryDocument(file(), 'fr')
    ];
    await new Promise<void>((resolve) => setImmediate(resolve));
    workers[2].emit('message', { text: 'Bonjour.' });
    workers[3].emit('message', { text: 'Bonsoir.' });
    await expect(Promise.all(next)).resolves.toMatchObject([
      { content: 'Bonjour.' },
      { content: 'Bonsoir.' }
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it('caps concurrent office parsers and releases capacity on exit', async () => {
    const file = () => new File(['synthetic'], 'book.pdf');
    const first = parseLibraryDocument(file(), 'fr');
    const second = parseLibraryDocument(file(), 'fr');
    await expect(parseLibraryDocument(file(), 'fr')).rejects.toMatchObject({
      code: 'LIBRARY_PARSE_BUSY'
    });
    expect(workers).toHaveLength(2);

    workers[0].emit('message', { text: 'Bonjour.' });
    workers[1].emit('message', { text: 'Bonsoir.' });
    await Promise.all([first, second]);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const next = parseLibraryDocument(file(), 'fr');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(workers).toHaveLength(3);
    workers[2].emit('message', { text: 'Merci.' });
    await next;
  });

  it('passes a worker error code through and restores parser capacity', async () => {
    const parsed = parseLibraryDocument(
      new File(['synthetic'], 'book.pdf'),
      'fr'
    );
    const rejected = expect(parsed).rejects.toMatchObject({
      code: 'LIBRARY_CONTENT_TOO_LARGE'
    });
    await tick();
    workers[0].emit('message', { code: 'LIBRARY_CONTENT_TOO_LARGE' });
    await rejected;
    await tick();
    await expectBothSlotsFree();
  });

  it('rejects a worker message with neither text nor a code', async () => {
    const parsed = parseLibraryDocument(
      new File(['synthetic'], 'book.pdf'),
      'fr'
    );
    const rejected = expect(parsed).rejects.toMatchObject({
      code: 'INVALID_LIBRARY_DOCUMENT'
    });
    await tick();
    workers[0].emit('message', {});
    await rejected;
    await tick();
    await expectBothSlotsFree();
  });

  it('does not leak a parser slot when the worker cannot start', async () => {
    spawn.failNext = true;
    await expect(
      parseLibraryDocument(new File(['synthetic'], 'book.pdf'), 'fr')
    ).rejects.toMatchObject({ code: 'INVALID_LIBRARY_DOCUMENT' });
    expect(workers).toHaveLength(0);
    await expectBothSlotsFree();
  });

  it('rejects office text over the content ceiling', async () => {
    const parsed = parseLibraryDocument(
      new File(['synthetic'], 'book.pdf'),
      'fr'
    );
    const rejected = expect(parsed).rejects.toMatchObject({
      code: 'LIBRARY_CONTENT_TOO_LARGE'
    });
    await tick();
    workers[0].emit('message', { text: 'a'.repeat(1_000_001) });
    await rejected;
    await tick();
    await expectBothSlotsFree();
  });
});
