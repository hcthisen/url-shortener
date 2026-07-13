import { randomBytes } from 'node:crypto';
import { isReserved } from './reserved.js';

// base58: no 0, O, I, l — codes stay unambiguous when read aloud or written down.
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const CUSTOM_CODE_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function generateCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE58[bytes[i] % BASE58.length];
  }
  return out;
}

export type CodeValidation = { ok: true } | { ok: false; reason: string };

export function validateCustomCode(code: string): CodeValidation {
  if (!CUSTOM_CODE_RE.test(code)) {
    return {
      ok: false,
      reason: 'Codes may only contain letters, numbers, hyphens and underscores (max 64 characters).',
    };
  }
  if (isReserved(code)) {
    return { ok: false, reason: `"${code}" is a reserved path and cannot be used as a code.` };
  }
  return { ok: true };
}
