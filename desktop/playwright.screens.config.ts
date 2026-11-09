import { defineConfig } from '@playwright/test';

// README screenshots from the real app with fictional demo data (see tests/screens/capture.spec.ts).
export default defineConfig({
  testDir: 'tests/screens',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
});
