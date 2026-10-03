import { hash, verify } from '@node-rs/argon2';
// Numeric enum values avoid the SDK ambient const-enum import under isolated ESM.
export const passwordOptions = {
  algorithm: 2,
  version: 1,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
};
export function validatePassword(password: string): void {
  if ([...password].length < 12 || Buffer.byteLength(password, 'utf8') > 1024)
    throw new Error('Password must be at least 12 characters and at most 1024 UTF-8 bytes');
}
export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  return hash(password, passwordOptions);
}
export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  try {
    return await verify(encoded, password);
  } catch {
    return false;
  }
}
