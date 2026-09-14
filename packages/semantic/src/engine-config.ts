/**
 * Where the engine lives and how we authenticate to it. `engineEndpoint` is internal to
 * this package by design and is NOT re-exported from `index.ts` -- it carries a
 * credential. (`bundleVersion`, at the end of this file, IS exported: a published
 * artifact version is not a secret, and the envelope and the cache key must read the
 * same one.)
 *
 * This used to be assembled in `apps/api/src/routes.ts` and threaded in as the facade's
 * first argument. Nothing semantic leaked that way -- no caller ever saw an engine query
 * object -- but two things did. The API layer owned the engine's lifecycle, so swapping
 * engines (the reversibility ADR-003 claims) meant editing a route module; and the
 * warehouse credential ran through a request handler, which is the last place it should
 * appear. TW-170 / ADR-006 section B item 3: the facade owns its own transport.
 *
 * Read fresh from the environment on every call rather than memoised. It is a property
 * lookup, the serving tier is stateless (binding constraint 6), and a cached copy is one
 * more thing that can be stale in a process that outlives a config change.
 */

/** The dev-loop default, matching `CUBE_PORT` in infra/versions.env. */
const DEFAULT_URL = 'http://localhost:7400/cubejs-api/v1';

/**
 * The same throwaway secret the compose files use, so `docker compose up` and a bare
 * `node` process agree without ceremony.
 *
 * It is deliberately NOT guarded by a `NODE_ENV === 'production'` check. Nothing in this
 * repo sets `NODE_ENV`, so such a check would ship complete and inert -- the exact shape
 * of the failure ADR-014's tenancy backstop had (T-130). The real answer is the secret
 * store, still an OPEN integration row in 07-domain-model.md section 4; until it lands,
 * the honest mechanism is that both sides of the compose file read the same variable.
 */
const DEV_API_SECRET = 'dev-only-not-a-secret';

export interface EngineEndpoint {
  url: string;
  apiSecret: string;
}

export function engineEndpoint(): EngineEndpoint {
  return {
    url: process.env['CUBE_URL'] ?? DEFAULT_URL,
    apiSecret: process.env['CUBEJS_API_SECRET'] ?? DEV_API_SECRET,
  };
}

/**
 * The published spec version being served (FR-GOV-08).
 *
 * It lives here rather than in `apps/api` because two things must agree on it: the
 * envelope's `bundle_version`, which is what makes a rollback observable, and the cache
 * key, which is what makes a rollback *take effect*. If those two ever read different
 * values, a cached result is served under a bundle version it was not computed for -- a
 * stale number wearing a fresh label, which is the single failure mode the envelope
 * exists to prevent. One reader, so they cannot drift.
 */
export function bundleVersion(): string {
  return process.env['TAILWIND_BUNDLE_VERSION'] ?? 'dev';
}
