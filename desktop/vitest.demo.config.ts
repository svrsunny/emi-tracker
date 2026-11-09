import { defineConfig } from 'vitest/config';

// `npm run demo:data`: writes demo/emi-tracker-demo-backup.json (fictional data). Not part of `npm test`.
export default defineConfig({
  test: {
    include: ['tests/demo/**/*.test.ts'],
    environment: 'node',
  },
});
