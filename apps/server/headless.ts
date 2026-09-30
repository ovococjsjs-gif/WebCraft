import { runCoreFixture } from '../../packages/core/src/fixture';
console.log(
  JSON.stringify({ runtime: 'node', fixture: 'foundation-v1', result: runCoreFixture() }, null, 2),
);
