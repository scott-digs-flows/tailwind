/**
 * The facade's public surface, and the whole of it.
 *
 * Two properties are enforced mechanically by tools/boundary-lint.ts rather than by
 * review habit (ADR-006 D4, TW-170): every exported function takes a `SecurityContext`,
 * and no exported name or type is the engine vendor's. Both are what make ADR-003's
 * reversibility claim a property of the code instead of a thing that happens to be true.
 */
export {
  type SecurityContext,
  resolveSecurityContext,
  securityContextDigest,
  pocSystemContext,
} from './security-context.ts';
export {
  compile,
  runQuery,
  applyRowLimit,
  DEFAULT_ROW_LIMIT,
  type SemanticQuery,
  type TimeDimension,
  type CompiledQuery,
  type QueryResult,
} from './facade.ts';
export {
  describeCatalog,
  type SemanticCatalog,
  type ViewDescriptor,
  type MetricDescriptor,
  type DimensionDescriptor,
  type DimensionType,
  type Certification,
} from './catalog.ts';
