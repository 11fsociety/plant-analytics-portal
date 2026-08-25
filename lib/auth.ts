/** Auth helpers using Web Crypto API - works in both Node and Edge runtimes. */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const padded = s + '='.repeat(pad);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET || 'change-me';
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(email: string): Promise<string> {
  const payload = { email, iat: Math.floor(Date.now() / 1000) };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await getKey();
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const sig = b64url(new Uint8Array(sigBuf));
  return `${body}.${sig}`;
}

export async function verifySession(token: string | undefined): Promise<{ email: string } | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  try {
    const key = await getKey();
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig) as any, enc.encode(body) as any);
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(body)));
    const age = Math.floor(Date.now() / 1000) - (payload.iat || 0);
    if (age > 30 * 24 * 3600) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkCredentials(email: string, password: string): boolean {
  const eEmail = process.env.PORTAL_EMAIL || '';
  const ePass = process.env.PORTAL_PASSWORD || '';
  if (!eEmail || !ePass) return false;
  return constantTimeEq(email, eEmail) && constantTimeEq(password, ePass);
}
