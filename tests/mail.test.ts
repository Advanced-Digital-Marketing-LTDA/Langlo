import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTransport } from 'nodemailer';
import {
  SmtpMailer,
  createMailer,
  defaultSmtpTimeouts
} from '../src/lib/server/mail';

vi.mock('nodemailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nodemailer')>();
  return { ...actual, createTransport: vi.fn(actual.createTransport) };
});

const message = { to: 'to@example.test', subject: 's', text: 't' };

describe('SmtpMailer timeouts', () => {
  let server: Server | undefined;
  const sockets: Socket[] = [];
  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve()
    );
    server = undefined;
  });

  it('pins the documented 10 s connection, 10 s greeting and 30 s socket limits', () => {
    expect(defaultSmtpTimeouts).toEqual({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000
    });
  });

  it('rejects when the provider accepts the connection but never greets', async () => {
    server = createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve)
    );
    const mailer = new SmtpMailer({
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      from: 'from@example.test',
      token: 'synthetic-token',
      timeouts: {
        connectionTimeout: 5000,
        greetingTimeout: 300,
        socketTimeout: 5000
      }
    });
    const started = Date.now();
    await expect(mailer.send(message)).rejects.toMatchObject({
      code: 'ETIMEDOUT',
      message: expect.stringMatching(/greeting/iu)
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(2500);
  });
});

describe('createMailer', () => {
  it('builds an SmtpMailer with the default timeouts for smtp config', () => {
    const mailer = createMailer({
      transport: 'smtp',
      from: 'from@example.test',
      protonSmtpToken: 'synthetic-token',
      smtpHost: '127.0.0.1',
      smtpPort: 587
    });
    expect(mailer).toBeInstanceOf(SmtpMailer);
    expect(vi.mocked(createTransport)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 587,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        requireTLS: true
      })
    );
  });

  it('refuses smtp config without a sender or token', () => {
    expect(() =>
      createMailer({
        transport: 'smtp',
        smtpHost: 'h.example.test',
        smtpPort: 587
      })
    ).toThrow('SMTP mail requires MAIL_FROM and PROTON_SMTP_TOKEN');
  });
});
