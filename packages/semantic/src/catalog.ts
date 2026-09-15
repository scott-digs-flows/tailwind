/**
 * What the requesting user may reference, in Tailwind's vocabulary.
 *
 * This replaces `cubeMeta(opts, ctx): Promise<unknown>`. It had no caller, and that was
 * the moment to change it: it would have acquired two at once -- metric discovery in the
 * UI and the AI context builder (TW-62) -- and `unknown` out of a facade is a guarantee
 * that every caller casts it back into the vendor's shape. At that point the engine's
 * metadata schema is in the prompt, the discovery UI and the eval suite simultaneously,
 * and ADR-003's "swapping engines costs about a day" stops being true.
 *
 * Three things the vendor's document carries that deliberately do NOT appear below:
 *
 *   - `aliasMember`, which names the private cube a view member resolves to
 *     (`fact_reseller_sales.reseller_sales`). FR-SEM-02 makes cubes private and views
 *     the only referencable surface; re-exporting the alias hands every caller a name
 *     it is not allowed to use, and an AI prompt containing it will eventually use it.
 *   - drill members, format specifiers and the engine's own `type`/`aggType` strings.
 *     Nothing needs them yet. A field added when a caller asks is a reviewed decision;
 *     a field passed through "in case" is a leak with a schedule.
 *   - anything at all about cubes. The engine returns only public entities, which the
 *     ADR-003 D2 profile makes exactly the views.
 *
 * The catalog is resolved PER REQUEST from the requesting user's context (FR-SEM-15),
 * because the engine scopes /meta by the JWT we mint: member-level policy is already
 * applied. Discovery therefore shows what this user may actually query, not what exists.
 * Caching one user's catalog and showing it to another would be the per-tenant mistake
 * FR-SEM-15 exists to forbid, wearing a different hat.
 */
import { cubeMeta } from './cube-client.ts';
import type { SecurityContext } from './security-context.ts';

/** FR-SEM-07's trust states. A closed union: an unrecognised value is not certified. */
export type Certification = 'certified' | 'draft' | 'deprecated';

/**
 * The data type of a dimension, at the granularity a caller actually branches on:
 * whether it can carry a time grain, and whether it is numeric. Anything else is
 * reported as `string`, which is how it is rendered and filtered anyway.
 */
export type DimensionType = 'string' | 'number' | 'boolean' | 'time';

/** FR-SEM-06's required metadata, in the shape a prompt or a discovery panel wants. */
export interface Governance {
  owner: string | undefined;
  description: string | undefined;
  /**
   * `undefined` when the artifact declares no certification or declares one we do not
   * recognise. Never silently `certified`: FR-SEM-06 makes missing metadata a CI
   * failure, so absence here means something upstream is already wrong, and the caller
   * that has to say "uncertified" is the one telling the truth.
   */
  certification: Certification | undefined;
}

export interface MetricDescriptor extends Governance {
  /** The view-qualified name -- the only name a chart or an AI answer may reference. */
  member: string;
  /** Short human label, e.g. `Reseller Sales`. */
  title: string;
}

export interface DimensionDescriptor extends Governance {
  member: string;
  title: string;
  type: DimensionType;
}

export interface ViewDescriptor extends Governance {
  /** The view name, and the prefix every one of its members carries. */
  name: string;
  title: string;
  metrics: MetricDescriptor[];
  dimensions: DimensionDescriptor[];
}

/**
 * An object rather than a bare array of views. This type is about to be consumed by the
 * AI context builder, a discovery UI and an eval suite at once, and the next thing it
 * needs is the bundle version the catalog was read from (ADR-007). Adding a sibling key
 * is additive; widening `ViewDescriptor[]` into an object later is not.
 */
export interface SemanticCatalog {
  views: ViewDescriptor[];
}

const CERTIFICATIONS = new Set<string>(['certified', 'draft', 'deprecated']);
const DIMENSION_TYPES = new Set<string>(['string', 'number', 'boolean', 'time']);

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * Tailwind's governance metadata rides in the artifact's `meta.tailwind` block and the
 * engine passes it through untouched (ADR-003 D2 -- carrying our own metadata without
 * forking was one of the four things that decided the engine choice).
 */
function governance(raw: unknown): Governance {
  const meta = (raw as { meta?: { tailwind?: Record<string, unknown> } } | undefined)?.meta?.tailwind;
  const certification = str(meta?.['certification']);
  return {
    owner: str(meta?.['owner']),
    description: str(meta?.['description']),
    certification:
      certification !== undefined && CERTIFICATIONS.has(certification) ? (certification as Certification) : undefined,
  };
}

interface RawMember {
  name?: unknown;
  shortTitle?: unknown;
  title?: unknown;
  type?: unknown;
}

interface RawEntity extends RawMember {
  description?: unknown;
  measures?: unknown;
  dimensions?: unknown;
}

const members = (v: unknown): RawMember[] => (Array.isArray(v) ? (v as RawMember[]) : []);

/**
 * Map the engine's metadata document onto the catalog.
 *
 * Exported so it can be tested against a RECORDED response (test/fixtures/engine-meta.json)
 * with no engine running. That fixture is the contract: when the pinned engine version
 * moves and the document changes shape, this is where it is supposed to break.
 *
 * Defensive on every field, because a metadata document that lost a `title` should
 * degrade a label, not throw inside a discovery panel. It is NOT defensive about
 * `name`: a member with no name cannot be referenced, so it is dropped rather than
 * offered as something the user can pick.
 */
export function toCatalog(raw: unknown): SemanticCatalog {
  const entities = (raw as { cubes?: unknown } | undefined)?.cubes;
  const views: ViewDescriptor[] = [];

  for (const entity of Array.isArray(entities) ? (entities as RawEntity[]) : []) {
    // `type` is 'view' for a view and 'cube' for a cube. The profile makes cubes
    // non-public so the engine omits them here anyway, but a belt-and-braces filter
    // costs one line and FR-SEM-02 is worth two mechanisms. An entity that declares no
    // type at all is kept: on an older engine build absence is not evidence it is a cube.
    if (entity.type === 'cube') continue;
    const name = str(entity.name);
    if (name === undefined) continue;

    views.push({
      name,
      title: str(entity.title) ?? name,
      ...governance(entity),
      metrics: members(entity.measures).flatMap((m) => {
        const member = str(m.name);
        return member === undefined
          ? []
          : [{ member, title: str(m.shortTitle) ?? str(m.title) ?? member, ...governance(m) }];
      }),
      dimensions: members(entity.dimensions).flatMap((d) => {
        const member = str(d.name);
        const type = str(d.type);
        return member === undefined
          ? []
          : [
              {
                member,
                title: str(d.shortTitle) ?? str(d.title) ?? member,
                type: type !== undefined && DIMENSION_TYPES.has(type) ? (type as DimensionType) : 'string',
                ...governance(d),
              },
            ];
      }),
    });
  }

  return { views };
}

/** Everything `ctx` may reference, already scoped to `ctx`. */
export async function describeCatalog(ctx: SecurityContext): Promise<SemanticCatalog> {
  return toCatalog(await cubeMeta(ctx));
}
