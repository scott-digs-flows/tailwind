import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineEndpoint } from '../src/engine-config.ts';

/**
 * The engine's address used to be assembled in `apps/api/src/routes.ts`. It is the
 * facade's now (TW-170), and these two assertions are what "owned here" means in
 * practice: the dev loop works with no configuration, and one variable moves it.
 */
test('the dev-loop default matches CUBE_PORT in infra/versions.env', () => {
  delete process.env['CUBE_URL'];
  assert.equal(engineEndpoint().url, 'http://localhost:7400/cubejs-api/v1');
});

test('the endpoint is read from the environment on every call, not captured once', () => {
  // conformance.sh points CUBE_URL at the fixture stack on port 7401 after the module
  // has already been imported by something else in the same process. A memoised value
  // would send the suite to the dev warehouse and quietly certify the wrong data.
  process.env['CUBE_URL'] = 'http://localhost:7401/cubejs-api/v1';
  assert.equal(engineEndpoint().url, 'http://localhost:7401/cubejs-api/v1');
  delete process.env['CUBE_URL'];
});
