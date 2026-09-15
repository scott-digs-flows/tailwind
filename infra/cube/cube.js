/**
 * Cube configuration. Deliberately minimal -- everything that can be a declarative
 * access_policy in the reviewed model belongs there (ADR-003 D4), because the model is
 * what a human reviews under CODEOWNERS. This file holds only what Cube cannot express
 * declaratively.
 *
 * NOT a Tailwind spec: it is engine configuration, not a reviewed artifact, which is
 * why it lives under infra/ rather than content/.
 */
module.exports = {
  /**
   * ADR-003 Correction 1: without `context_to_groups`, `access_policy` matches nothing,
   * and Cube Core does not map users to policy groups for you. This function is
   * load-bearing, not glue.
   *
   * CORRECTED 2026-09-15 (TW-174). This comment used to say that omitting it makes Cube
   * "serve every row" -- that it fails OPEN and silently. Measured against the pinned
   * v1.7.18 with the current model, it does not: removing this function makes every
   * query on a policy-bearing VIEW fail with "You requested hidden member", for every
   * caller, because member-level access is denied when no policy matches. Loud, and the
   * opposite of silent.
   *
   * The correction matters more than the detail. A false comment about a security
   * control is how the next person builds on a guarantee that is not there -- the same
   * class of defect as ADR-014's backstop shipping complete and inert (T-130) -- and
   * "it fails open" invites someone to add a fallback that really would.
   *
   * What is NOT claimed here: that Cube fails closed in general. This is one engine
   * version, one model shape, views carrying `access_policy` with `member_level`. A raw
   * cube with no policy is public by default, which is why default-deny is still ours to
   * enforce (content/README.md rule 5). The property is checked rather than trusted:
   * scripts/rls-e2e.sh runs two users through the serving path on every build, and its
   * negative control weakens the row FILTER rather than unplugging this function --
   * precisely because unplugging it errors, and a suite that only has to notice an error
   * would not notice a leak.
   */
  // NOTE the name. Cube's current docs say `contextToRoles`; v1.7.18 accepts only
  // `contextToGroups`, and rejects the other at startup. Verified against the image's
  // own option validator rather than the documentation.
  contextToGroups: async ({ securityContext }) => {
    const groups = securityContext?.groups;
    // No resolved groups means no policy matches, which -- given default-deny below --
    // means no rows. That is the correct answer, not an inconvenience to work around.
    return Array.isArray(groups) ? groups : [];
  },

  /**
   * ADR-014: tenant scopes the compiled MODEL and the connection pool. Note this is
   * per-TENANT, not per-user: COMPILE_CONTEXT cannot express a per-user predicate, and
   * minting per-user app ids is documented as not scaling. Per-user predicates are the
   * job of access_policy / query_rewrite below (FR-SEM-15).
   */
  contextToAppId: ({ securityContext }) => `tenant:${securityContext?.tenant ?? 'none'}`,
  contextToOrchestratorId: ({ securityContext }) => `tenant:${securityContext?.tenant ?? 'none'}`,

  /**
   * Default-deny at the engine boundary. A query with no resolved tenant is REJECTED
   * rather than passed through (FR-SEM-14). The facade already refuses this, so this is
   * the second of two independent gates -- deliberately, because the cost of the check
   * is nil and the cost of it being missing is every row.
   */
  queryRewrite: (query, { securityContext }) => {
    if (typeof securityContext?.tenant !== 'string' || securityContext.tenant === '') {
      throw new Error('no resolved tenant: refusing to serve (FR-SEM-14)');
    }
    return query;
  },
};
