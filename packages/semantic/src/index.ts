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
  prepareQuery,
  runQuery,
  applyRowLimit,
  DEFAULT_ROW_LIMIT,
  type SemanticQuery,
  type TimeDimension,
  type CompiledQuery,
  type PreparedQuery,
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
// The published artifact version, and ONLY that. `engineEndpoint` stays internal: the
// endpoint carries a credential and TW-170 exists to keep it inside this package. A
// bundle version is not a credential, and the envelope and the cache key have to read
// the same one or a cached result is served under a version it was not computed for.
export { bundleVersion } from './engine-config.ts';
// The cache API's shape. No store: TW-44 builds that against these types (ADR-008).
export {
  cacheKeyFor,
  cacheKeyString,
  cacheLookupFor,
  type CacheKey,
  type CacheLookup,
  type CacheOutcome,
  type CachedResult,
  type ResultCache,
} from './cache.ts';
