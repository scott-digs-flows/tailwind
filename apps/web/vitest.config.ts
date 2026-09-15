import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The rest of the repo tests with `node --test`, and this package cannot: Node strips
 * types, it does not compile JSX, so a `.tsx` component is unreachable from it. The
 * alternative -- testing only the pure state modules and asserting nothing about the
 * components -- would leave FR-VIZ-13's sharpest clause untested, because "a chart
 * never displays a previous query's number" is a claim about what is on screen during
 * a transition, not about a reducer in isolation. Both are tested; this config is what
 * makes the first half possible.
 *
 * jsdom rather than a browser: these assertions are about which text and which
 * affordances exist in which state. Nothing here needs layout or a GPU, and ECharts is
 * only ever asked to draw in the one state where real rows exist.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    restoreMocks: true,
  },
});
