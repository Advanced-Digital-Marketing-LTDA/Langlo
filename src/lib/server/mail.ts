import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';
import type { AuthMailConfig } from './config.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** In-memory capture for same-process tests. */
export class CaptureMailer implements Mailer {
  readonly messages: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.messages.push({ ...message });
  }
}

/** JSON-per-message capture for cross-process (built-server/e2e) tests. */
export class FileCaptureMailer implements Mailer {
  #dir: string;
  #counter = 0;
  constructor(dir: string) {
    this.#dir = dir;
  }
  async send(message: MailMessage): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    const name = `${Date.now()}-${process.pid}-${this.#counter++}.json`;
    await writeFile(join(this.#dir, name), JSON.stringify(message), {
      mode: 0o600
    });
  }
}

/** Proton SMTP submission: PLAIN auth, username is the custom-domain sender. */
export class SmtpMailer implements Mailer {
  #from: string;
  #transporter: Transporter;
  constructor(config: {
    host: string;
    port: number;
    from: string;
    token: string;
  }) {
    this.#from = config.from;
    this.#transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      requireTLS: true,
      auth: { user: config.from, pass: config.token }
    });
  }
  async send(message: MailMessage): Promise<void> {
    await this.#transporter.sendMail({
      from: this.#from,
      to: message.to,
      subject: message.subject,
      text: message.text
    });
  }
}

export function createMailer(config: AuthMailConfig): Mailer {
  if (config.transport === 'smtp') {
    return new SmtpMailer({
      host: config.smtpHost,
      port: config.smtpPort,
      from: config.from!,
      token: config.protonSmtpToken!
    });
  }
  return config.captureDir
    ? new FileCaptureMailer(config.captureDir)
    : new CaptureMailer();
}
