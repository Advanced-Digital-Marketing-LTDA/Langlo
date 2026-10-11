import type { Auth } from './auth.ts';

export class ProvisionError extends Error {
  constructor(reason: 'invalid' | 'unavailable') {
    super(`Cannot provision account: ${reason}`);
    this.name = 'ProvisionError';
  }
}

const emailPattern = /^[^\s@]{1,254}@[^\s@]{1,253}\.[^\s@]{2,63}$/;

/**
 * Server-only account creation for the closed pilot. Mirrors the framework's
 * sign-up writes exactly: a users row plus a credential account row whose
 * accountId is the new user's id, with the password hashed by the framework's
 * own hasher so sign-in verification stays single-sourced.
 */
export async function provisionAccount(
  auth: Auth,
  input: { email: string; name: string; password: string }
): Promise<{ userId: string; email: string; name: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!emailPattern.test(email) || !name || input.password.length < 12)
    throw new ProvisionError('invalid');
  const context = await auth.$context;
  const password = await context.password.hash(input.password);
  let user: { id: string };
  try {
    user = await context.internalAdapter.createUser(
      { email, name, emailVerified: true },
      { method: 'admin' }
    );
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password
    });
  } catch {
    throw new ProvisionError('unavailable');
  }
  return { userId: user.id, email, name };
}
