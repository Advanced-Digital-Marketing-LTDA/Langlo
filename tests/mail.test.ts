import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SmtpMailer,
  createMailer,
  defaultSmtpTimeouts
} from '../src/lib/server/mail';

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

  it('defines finite connection, greeting and socket limits', () => {
    for (const value of Object.values(defaultSmtpTimeouts)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
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
        connectionTimeout: 500,
        greetingTimeout: 200,
        socketTimeout: 500
      }
    });
    const started = Date.now();
    await expect(mailer.send(message)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
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
