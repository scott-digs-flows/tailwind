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
  ].join('\n');
};

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
