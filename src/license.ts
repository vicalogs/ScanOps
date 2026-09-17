import { DEFAULT_LICENSE_ENDPOINT } from './service.js';
export type LicenseConfig = {
  /** License key issued for a specific set of domains. */
  key: string;
  /** Override the built-in licence service. Only this repo's own demo and ngrok development need it. */
  endpoint?: string;
};
export type LicenseAuthorization = {
  token: string;
  /** Public per-customer id; the asset path prefix this license may read from. */
  customerId: string;
  expiresAt: number;
};
export class LicenseError extends Error {
  constructor(message: string, readonly reason: string) { super(message); this.name = 'LicenseError'; }
}

/**
 * Asks the license service to authorize this page's origin for the given key.
 * The service trusts only the browser-set `Origin` header, not anything sent
 * from here, so this call cannot be satisfied by editing client code alone.
 */
export async function verifyLicense({ key, endpoint = DEFAULT_LICENSE_ENDPOINT }: LicenseConfig, signal?: AbortSignal): Promise<LicenseAuthorization> {
  if (!key) throw new TypeError('ScanOps requires a license: { key }');
  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ licenseKey: key }), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new LicenseError('Could not reach the ScanOps license service', 'network_error');
  }
  const body = await response.json().catch(() => null) as Partial<LicenseAuthorization & { error: string }> | null;
  if (!response.ok) {
    const host = typeof window === 'undefined' ? 'this host' : window.location.hostname;
    throw new LicenseError(`ScanOps is not authorized to run on ${host} (${body?.error ?? response.status})`, body?.error ?? 'unauthorized');
  }
  if (typeof body?.token !== 'string' || typeof body.customerId !== 'string' || typeof body.expiresAt !== 'number') throw new LicenseError('ScanOps license service returned an unexpected response', 'bad_response');
  return { token: body.token, customerId: body.customerId, expiresAt: body.expiresAt };
}
