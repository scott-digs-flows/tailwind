/** meta blocks indented for each nesting level; sharing one string collides the keys. */
export const meta = (indent: number): string => {
  const p = ' '.repeat(indent);
  return [
    `${p}meta:`,
    `${p}  tailwind:`,
    `${p}    spec_version: 1`,
    `${p}    owner: data-team`,
    `${p}    description: Orders placed by resellers.`,
    `${p}    certification: certified`,
    `${p}    last_reviewed: '2026-08-12'`,
  ].join('\n');
};

/** The four FR-SEM-06 fields, as they appear in a meta block. Tests delete one at a
 *  time from a known-good fixture, so the list has to match the schema's `required`. */
export const REQUIRED_META_FIELDS = ['owner', 'description', 'certification', 'last_reviewed'] as const;

/**
 * Drop the first `key: value` line for `field` — the negative control for FR-SEM-06.
 * `(\n|$)` rather than `\n` because `meta()` returns a block with no trailing newline,
 * so the last field would otherwise be un-removable and its test would silently assert
 * nothing.
 */
export const without = (src: string, field: string): string =>
  src.replace(new RegExp(`^ *${field}: .*(\\n|$)`, 'm'), '');

export const VALID_CUBE = `cubes:
  - name: orders
    sql_table: orders
    public: false
${meta(4)}
    measures:
      - name: revenue
        type: sum
        sql: amount
${meta(8)}
    dimensions:
      - name: order_date
        sql: order_date
        type: time
${meta(8)}
`;

export const VALID_VIEW = `views:
  - name: orders
    cubes:
      - join_path: orders
        includes: "*"
    access_policy:
      - group: "*"
        row_level:
          filters: []
${meta(4)}
`;

export const VALID_DASHBOARD = `spec_version: 1
name: sales
title: Sales
freshness:
  class: standard
${meta(0)}
charts:
  - id: revenue_kpi
    title: Revenue
    type: kpi
    layout: { x: 0, y: 0, w: 3, h: 2 }
    query:
      view: orders
      metrics: [orders.revenue]
`;
