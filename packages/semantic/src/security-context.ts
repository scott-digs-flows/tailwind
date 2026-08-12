import { createHash } from 'node:crypto';

declare const BRAND: unique symbol;

/**
 * The resolved security context for ONE request: tenant, subject, groups.
 *
 * ADR-006 D4 -- this is a type, not a convention. It is branded so it cannot be
 * produced by an object literal; the only way in is `resolveSecurityContext`.
 * That is what makes FR-SEM-14 mechanical: every query-construction call takes
 * one, and there is no overload that omits it.
 *
 * FR-SEM-15 -- resolved PER REQUEST, never per tenant. Cube's COMPILE_CONTEXT is
 * per-tenant only and cannot express a per-user predicate; row filters go through
 * `access_policy` / `query_rewrite`. See 02-architecture-brief.md section 2.4.
 */
export interface SecurityContext {
  readonly [BRAND]: true;
  readonly tenant: string;
  readonly subject: string;
  readonly groups: readonly string[];
}

export function resolveSecurityContext(input: {
  tenant: string;
  subject: string;
  groups: readonly string[];
}): SecurityContext {
  if (!input.tenant) {
    // FR-SEM-14: a request with no resolved tenant is rejected, not served.
    throw new Error('security context requires a tenant');
  }
  return Object.freeze({
    tenant: input.tenant,
    subject: input.subject,
    groups: Object.freeze([...input.groups]),
  }) as unknown as SecurityContext;
}

/**
 * Stable digest of the context, carried on every response so a test can assert
 * that two users got two differently-scoped results (ADR-006 D3). Groups are
 * sorted so the digest is order-independent.
 */
export function securityContextDigest(ctx: SecurityContext): string {
  return createHash('sha256')
    .update(JSON.stringify([ctx.tenant, ctx.subject, [...ctx.groups].sort()]))
    .digest('hex')
    .slice(0, 16);
}

/**
 * The POC's permissive context. 08-poc-scope.md section 3.1: populate it
 * permissively if you must, but the SHAPE has to be right from the first query --
 * retrofitting a security dimension into the compiler and the cache is a rewrite
 * of both, and it is the single most expensive thing on that page to get wrong.
 */
export function pocSystemContext(tenant = 'internal'): SecurityContext {
  // 'analyst' is a group the reviewed access_policy actually matches. A group that
  // matches nothing would get nothing -- which is default-deny working, not a bug.
  return resolveSecurityContext({ tenant, subject: 'system', groups: ['analyst'] });
}
