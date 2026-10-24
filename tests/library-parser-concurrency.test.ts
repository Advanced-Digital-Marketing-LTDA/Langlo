import { afterEach, describe, expect, it, vi } from 'vitest';

const { workers, FakeWorker } = vi.hoisted(() => {
  const workers: { emit: (event: string, value: unknown) => void }[] = [];
  class FakeWorker {
    listeners = new Map<string, ((value: unknown) => void)[]>();

    constructor() {
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
  return { workers, FakeWorker };
});

vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }));

import { parseLibraryDocument } from '../src/lib/server/library';

afterEach(() => {
  vi.useRealTimers();
  workers.length = 0;
});

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
});
