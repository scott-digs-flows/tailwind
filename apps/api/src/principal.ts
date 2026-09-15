import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pocSystemContext, resolveSecurityContext, type SecurityContext } from '@tailwind/semantic';

/**
 * Who is asking, resolved ONCE PER REQUEST, server-side, before any handler runs.
 *
 * This is the middleware ADR-006 D4 and ADR-014 D2 both specify: one function derives
 * `SecurityContext(tenant, subject, groups)` from the principal and REJECTS the request
 * if it cannot (FR-SEM-14). Until now the API had no such step -- every route called
 * `pocSystemContext()` directly, so there was no principal to fail to resolve and the
 * rejection FR-SEM-14 requires was unreachable by construction.
 *
 * Two properties are load-bearing and neither is negotiable later:
 *
 * **The tenant never arrives from the client.** ADR-014 D2: "there is no code path where
 * a tenant arrives as a query parameter, a header, or a request body field." So the
 * request carries a SUBJECT claim and nothing else; tenant and groups are looked up
 * here, in a server-side directory. A `x-tailwind-tenant` header would be the whole of
 * multi-tenancy handed to the caller, and it is the reason this file does not have one.
 *
 * **Resolution is per request, not per tenant** (FR-SEM-15). Nothing is memoised across
 * requests: two subjects of one tenant produce two different contexts, which is what the
 * end-to-end proof in `test/e2e/rls-two-users.ts` exists to demonstrate against a live
 * engine rather than against this file's intent.
 *
 * ## What is honest about this in the POC, and what is not
 *
 * The subject claim is an UNAUTHENTICATED HEADER. There is no login yet -- SSO is TW-89
 * (`08-poc-scope.md §3.3`) -- so anyone who can reach the port can claim any subject in
 * the directory. That is acceptable only because the two things SSO changes are the
 * *source* of the claim and its *verification*, both of which live in the one function
 * below; the resolution step, the directory lookup, the rejection and the shape of the
 * object are real now. When TW-89 lands, `subjectClaim` reads a verified token claim and
 * nothing else on this path moves.
 *
 * It also fails CLOSED by default in the sense that matters: with no directory
 * configured there are no identities to impersonate, and the API behaves exactly as it
 * did before -- every request gets the permissive POC system context. Configuring a
 * directory is what turns identity on, and from that moment an unknown subject is
 * refused rather than quietly served as `system`.
 */

/**
 * The claimed subject. One header, deliberately: everything else about a principal is
 * the server's business (ADR-014 D2).
 */
export const SUBJECT_HEADER = 'x-tailwind-subject';

/** Where the directory comes from. See `principalDirectory` for the shape. */
export const DIRECTORY_ENV = 'TAILWIND_PRINCIPALS';

/** Liveness must not depend on identity: a health check that 403s is a broken deploy that
 *  cannot be diagnosed. Everything else requires a resolved principal. */
const ANONYMOUS_PATHS = new Set(['/healthz']);

export interface PrincipalRecord {
  subject: string;
  tenant: string;
  groups: readonly string[];
}

/**
 * The request could not be attributed to a principal, so it gets no security context.
 * Distinct from a configuration fault below, because the two deserve different answers:
 * this one is 403 (ADR-014 D2), that one is 500.
 */
export class UnresolvedPrincipal extends Error {}

/** The directory itself is malformed. An operator error, not the caller's -- answering
 *  403 here would tell the user they are not allowed when the truth is that we cannot
 *  tell, and that is the kind of message that costs an hour at 2am. */
export class PrincipalDirectoryError extends Error {}

/**
 * The principals this deployment knows about, or `undefined` when none are configured.
 *
 *   TAILWIND_PRINCIPALS='[{"subject":"morgan","tenant":"internal","groups":["analyst"]}]'
 *
 * A hand-maintained list is the POC's answer to "where do identities come from", and it
 * matches the pilot plan: about fifteen people, roles assigned by hand (TW-155). The
 * durable store is M1 work and needs ADR-009 (TW-173) to say what a row entitlement may
 * read from; hard-coding a richer shape now would be guessing at that decision.
 *
 * Read fresh from the environment on every request rather than memoised, for the same
 * reason `engine-config.ts` does: the serving tier is stateless (binding constraint 6),
 * it is a JSON parse over a handful of entries, and a cached copy is one more thing that
 * can be stale in a process that outlives a config change.
 */
export function principalDirectory(): Map<string, PrincipalRecord> | undefined {
  const raw = process.env[DIRECTORY_ENV];
  if (raw === undefined || raw.trim() === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    throw new PrincipalDirectoryError(`${DIRECTORY_ENV} is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  if (!Array.isArray(parsed)) throw new PrincipalDirectoryError(`${DIRECTORY_ENV} must be a JSON array`);

  const bySubject = new Map<string, PrincipalRecord>();
  for (const entry of parsed) {
    const r = entry as Partial<PrincipalRecord>;
    // Validated rather than trusted. A typo'd key would otherwise produce a principal
    // with an undefined tenant, and an undefined tenant is a tenant nobody owns.
    if (typeof r?.subject !== 'string' || r.subject === '') {
      throw new PrincipalDirectoryError(`${DIRECTORY_ENV}: every entry needs a non-empty 'subject'`);
    }
    if (typeof r.tenant !== 'string' || r.tenant === '') {
      throw new PrincipalDirectoryError(`${DIRECTORY_ENV}: principal '${r.subject}' has no tenant`);
    }
    const groups = r.groups ?? [];
    if (!Array.isArray(groups) || groups.some((g) => typeof g !== 'string')) {
      throw new PrincipalDirectoryError(`${DIRECTORY_ENV}: principal '${r.subject}' has non-string groups`);
    }
    bySubject.set(r.subject, { subject: r.subject, tenant: r.tenant, groups });
  }
  return bySubject;
}

/** The claimed subject, or undefined. TW-89 replaces this one line with a verified token
 *  claim; that it is one line is the point of having it separately named. */
function subjectClaim(headers: FastifyRequest['headers']): string | undefined {
  const raw = headers[SUBJECT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * The single resolution step. Every source of identity funnels through here, so the
 * FR-SEM-14 rejection is written once and cannot be forgotten by the next source added.
 */
export function resolvePrincipal(headers: FastifyRequest['headers']): SecurityContext {
  const directory = principalDirectory();

  // No directory: no identities exist yet, so the API answers as it did before SSO was
  // on the horizon -- one permissive system principal (08-poc-scope.md §3.1). This is
  // the branch the dev loop and the walking skeleton run on.
  if (directory === undefined) return pocSystemContext();

  const subject = subjectClaim(headers);
  if (subject === undefined) throw new UnresolvedPrincipal('no subject claim on the request');

  const record = directory.get(subject);
  // The unresolved case FR-SEM-14 names: we know who they claim to be and we cannot say
  // which tenant that is. Served permissively, this is a cross-tenant read; served as an
  // empty result, it is a silent wrong answer. Refused, it is a support ticket.
  if (record === undefined) throw new UnresolvedPrincipal(`principal '${subject}' resolves to no tenant`);

  return resolveSecurityContext({ tenant: record.tenant, subject: record.subject, groups: record.groups });
}

/**
 * The resolved context for a request.
 *
 * A WeakMap rather than a request decorator, because the accessor can then THROW when
 * the hook has not run. A decorated property has to be initialised to something, and
 * that something would be either `null` (checked by every caller, forgotten by one) or a
 * permissive default (fail-open, in the one place in this codebase where fail-open is
 * most expensive). There is no reading of this map that produces a context the
 * middleware did not resolve.
 */
const RESOLVED = new WeakMap<FastifyRequest, SecurityContext>();

export function principalOf(req: FastifyRequest): SecurityContext {
  const ctx = RESOLVED.get(req);
  if (ctx === undefined) {
    // Unreachable while the hook is registered, which is why it is worth saying out
    // loud: reaching it means a route was registered outside `registerRoutes` and is
    // serving data with no resolved identity.
    throw new Error(`no principal resolved for ${req.method} ${req.url}: the identity hook did not run`);
  }
  return ctx;
}

/**
 * Wire the middleware. Registered by `registerRoutes` rather than by the app builder, so
 * that there is no way to register the routes without it -- including from a test.
 *
 * `onRequest` is the earliest hook Fastify offers: it runs before the body is parsed and
 * before any handler, which is the "before any handler runs" in ADR-014 D2 and the
 * "before any SQL is built" in this ticket's acceptance. Rejecting later would still
 * produce a 403, but it would be a 403 after the query had been compiled, and the
 * difference between those two is the whole point.
 */
export function registerPrincipalResolution(app: FastifyInstance): void {
  const directory = principalDirectory();
  if (directory !== undefined) {
    // Observability for the mode that matters: an operator reading the logs can see that
    // identity is on, how many principals exist, and that the claim is not yet verified.
    app.log.warn(
      { principals: directory.size, header: SUBJECT_HEADER },
      'identity: principals resolved from the configured directory; the subject header is NOT authenticated until TW-89',
    );
  }

  app.addHook('onRequest', async (req, reply) => {
    if (ANONYMOUS_PATHS.has(req.url.split('?')[0] ?? req.url)) return;
    try {
      RESOLVED.set(req, resolvePrincipal(req.headers));
    } catch (e: unknown) {
      if (e instanceof UnresolvedPrincipal) {
        req.log.warn({ err: e, claimed: subjectClaim(req.headers) ?? null }, 'request refused: no security context');
        // No envelope, deliberately. Every served response carries one (ADR-006 D3) and
        // its `security_context_digest` proves which context produced the result -- a
        // rejected request has no context, and minting a digest of a context that never
        // existed would make the one field a test relies on a lie.
        await reply.code(403).send({ error: e.message, code: 'unresolved_principal' });
        return reply;
      }
      if (e instanceof PrincipalDirectoryError) {
        req.log.error({ err: e }, 'principal directory is unusable');
        await reply.code(500).send({ error: e.message, code: 'principal_directory_invalid' });
        return reply;
      }
      throw e;
    }
    return;
  });
}
