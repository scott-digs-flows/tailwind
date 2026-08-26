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
   * ADR-003 Correction 1, and the sharpest trap in the whole integration: WITHOUT
   * context_to_groups, `access_policy` matches nothing and Cube serves every row.
   * It fails OPEN and silently. A fail-open security layer in a governance product is
   * a contradiction in terms, so this function is load-bearing, not glue.
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
