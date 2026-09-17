/**
 * Where the licence service lives. Baked in at build time (scripts/build.mjs passes
 * `SCANOPS_SERVICE_ORIGIN`) so integrators only ever supply their key — the endpoints
 * are ours, not theirs to configure.
 *
 * Both are still accepted as options: this repo's own demo imports the SDK from source
 * rather than the built bundle, where the define never runs, and ngrok development
 * points at a throwaway origin. When the define is absent the URLs stay same-origin,
 * which is exactly what those two cases want.
 *
 * To be clear about what this is: it removes a configuration knob and stops the public
 * snippet advertising where the licence check goes. It is not a security boundary —
 * anyone editing the bundle can still point it elsewhere. What actually stops that is
 * the engine refusing to open a locator seal it did not issue.
 */
declare const SCANOPS_SERVICE_ORIGIN: string | undefined;

// `typeof` on an undeclared identifier is safe; a bare read would throw. The build
// strips any trailing slash, so nothing here has to normalise it.
const origin = typeof SCANOPS_SERVICE_ORIGIN === 'string' ? SCANOPS_SERVICE_ORIGIN : '';

export const DEFAULT_LICENSE_ENDPOINT = `${origin}/api/license/authorize`;
export const DEFAULT_LICENSED_ASSETS_URL = `${origin}/api/license/assets/`;
