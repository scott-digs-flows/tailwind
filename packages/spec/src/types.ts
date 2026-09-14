/**
 * Hand-maintained view of the shapes the app consumes. The schemas in schemas/v1
 * are the contract; these mirror the subset the renderer and the facade need.
 * A test asserts a valid fixture satisfies both, so drift fails CI rather than
 * surfacing at runtime.
 */
export type FreshnessClass = 'batch' | 'standard' | 'operational';
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
  meta: { tailwind: { owner: string; description: string; certification: string; last_reviewed?: string } };
  charts: DashboardChart[];
}
