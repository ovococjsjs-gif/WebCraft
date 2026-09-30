import { defineConfig } from 'vitest/config';
import { aliases } from './scripts/aliases';
export default defineConfig({
  resolve: { alias: aliases },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
