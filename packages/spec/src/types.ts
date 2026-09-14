/**
 * Hand-maintained view of the shapes the app consumes. The schemas in schemas/v1
 * are the contract; these mirror the subset the renderer and the facade need.
 * A test asserts a valid fixture satisfies both, so drift fails CI rather than
 * surfacing at runtime.
 */
export type FreshnessClass = 'batch' | 'standard' | 'operational';
export type Certification = 'certified' | 'draft' | 'deprecated';

/**
 * FR-SEM-06's four fields, carried by every cube, view, measure, dimension and
 * dashboard. All four are non-optional here because all four are `required` in
 * `schemas/v1/cube.json#/$defs/meta` — the provenance badge, the catalog and the AI
 * context builder are the consumers, and none of them should be written against a
 * `string | undefined` for a field CI guarantees is present.
 *
 * `replaced_by` is the exception and stays optional on purpose: it is only meaningful
 * alongside `certification: deprecated` (FR-SEM-07), which TW-31 owns.
 */
export interface TailwindMeta {
  spec_version: 1;
  owner: string;
  description: string;
  certification: Certification;
  last_reviewed: string;
  replaced_by?: string;
}
export type ChartType = 'line' | 'bar' | 'table' | 'kpi';
export type FilterOperator =
  | 'equals' | 'notEquals' | 'in' | 'notIn' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';

export interface TimeDimensionRef {
  member: string;
  granularity: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

export interface ChartQuery {
  view: string;
  metrics: string[];
  dimensions?: string[];
  time_dimensions?: TimeDimensionRef[];
  filters?: { member: string; operator: FilterOperator; values: string[] }[];
  order?: { member: string; dir: 'asc' | 'desc' }[];
  limit?: number;
}

export interface DashboardChart {
  id: string;
  title: string;
  type: ChartType;
  layout: { x: number; y: number; w: number; h: number };
  query: ChartQuery;
}

export interface Dashboard {
  spec_version: 1;
  name: string;
  title: string;
  freshness: { class: FreshnessClass };
  meta: { tailwind: TailwindMeta };
  charts: DashboardChart[];
}
