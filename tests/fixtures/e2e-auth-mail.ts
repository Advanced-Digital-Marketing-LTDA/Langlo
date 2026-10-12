import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const e2eAuthPort = '4174';
export const e2eAuthServerPort = '4175';
export const e2eAuthOrigin = `http://localhost:${e2eAuthPort}`;
export const mailCaptureDirectory = join(tmpdir(), 'langlo-e2e-auth-mail');
