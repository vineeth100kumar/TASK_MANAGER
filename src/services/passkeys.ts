// Trusted devices: unlock Sage with the device's own Face ID / Touch ID /
// Windows Hello instead of typing the password. This is the browser half of
// WebAuthn; the Pi (raspberry_pi/passkeys.py) holds the public keys and does
// the verifying. The password stays as the fallback, so none of this is
// required — it only appears where the browser can actually do it.

import { piBackendUrl, piHeaders } from './piBackend';

export interface PasskeyStatus {
  available: boolean;   // the Pi has the library and the feature on
  gate: boolean;        // a password is set (passkeys sit on top of it)
  secure: boolean;      // the page is a secure context (HTTPS or localhost)
  hasDevices: boolean;  // at least one device is already trusted
  rpId: string;
}

export interface TrustedDevice {
  id: string;
  name: string;
  createdAt: number | null;
  lastUsedAt: number | null;
  synced: boolean;
}

// --- base64url <-> ArrayBuffer (WebAuthn speaks base64url over JSON) ---
function b64urlToBuf(value: string): ArrayBuffer {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const base64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function api(path: string) {
  const base = piBackendUrl();
  return `${base}${path}`;
}

async function postJson(path: string, body?: unknown): Promise<any> {
  const res = await fetch(api(path), {
    method: 'POST',
    credentials: 'include',
    headers: piHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

// Whether this browser could use a passkey at all: the API exists and the page
// is a secure context. On plain-http LAN this is false, and we fall back to the
// password cleanly rather than offering something that can't work.
export function browserSupportsPasskeys(): boolean {
  return typeof window !== 'undefined'
    && !!window.PublicKeyCredential
    && window.isSecureContext === true
    && !!(navigator.credentials && navigator.credentials.create);
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  try {
    if (!browserSupportsPasskeys()) return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function passkeyStatus(): Promise<PasskeyStatus | null> {
  if (!piBackendUrl()) return null;
  try {
    const res = await fetch(api('/api/webauthn/status'), { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- Trust this device (make a passkey) ---
export async function trustThisDevice(name?: string): Promise<TrustedDevice> {
  if (!browserSupportsPasskeys()) {
    throw new Error("This browser can't make a passkey here. Open Sage over its HTTPS link first.");
  }
  const options = await postJson('/api/webauthn/register/begin');
  const session = options.sageSession;
  delete options.sageSession;
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    user: { ...options.user, id: b64urlToBuf(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c: any) => ({ ...c, id: b64urlToBuf(c.id) })),
  };
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
  } catch (e: any) {
    if (e?.name === 'NotAllowedError') throw new Error('Cancelled.');
    if (e?.name === 'InvalidStateError') throw new Error('This device is already trusted.');
    throw new Error("Couldn't set up this device.");
  }
  if (!credential) throw new Error("Couldn't set up this device.");
  const resp = credential.response as AuthenticatorAttestationResponse;
  const payload = {
    id: credential.id,
    rawId: bufToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufToB64url(resp.clientDataJSON),
      attestationObject: bufToB64url(resp.attestationObject),
      transports: typeof resp.getTransports === 'function' ? resp.getTransports() : [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: (credential as any).authenticatorAttachment,
  };
  const done = await postJson('/api/webauthn/register/complete', { credential: payload, session, name });
  return done.device;
}

// --- Log in with the passkey (used on the login screen) ---
export async function loginWithPasskey(): Promise<boolean> {
  if (!browserSupportsPasskeys()) return false;
  const options = await postJson('/api/webauthn/auth/begin');
  const session = options.sageSession;
  delete options.sageSession;
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c: any) => ({ ...c, id: b64urlToBuf(c.id) })),
  };
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
  } catch (e: any) {
    if (e?.name === 'NotAllowedError') throw new Error('Cancelled.');
    throw new Error("Couldn't check your passkey.");
  }
  if (!credential) return false;
  const resp = credential.response as AuthenticatorAssertionResponse;
  const payload = {
    id: credential.id,
    rawId: bufToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufToB64url(resp.clientDataJSON),
      authenticatorData: bufToB64url(resp.authenticatorData),
      signature: bufToB64url(resp.signature),
      userHandle: resp.userHandle ? bufToB64url(resp.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: (credential as any).authenticatorAttachment,
  };
  const done = await postJson('/api/webauthn/auth/complete', { credential: payload, session });
  return !!done.success;
}

// --- Managing trusted devices (Settings) ---
export async function listTrustedDevices(): Promise<TrustedDevice[]> {
  const res = await fetch(api('/api/webauthn/devices'), { credentials: 'include', headers: piHeaders() });
  if (!res.ok) throw new Error('Could not load devices.');
  const data = await res.json();
  return data.devices || [];
}

export async function renameTrustedDevice(id: string, name: string): Promise<void> {
  await postJson('/api/webauthn/devices/rename', { id, name });
}

export async function revokeTrustedDevice(id: string): Promise<void> {
  await postJson('/api/webauthn/devices/revoke', { id });
}

export async function revokeAllTrustedDevices(): Promise<void> {
  await postJson('/api/webauthn/devices/revoke', { all: true });
}
