import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'
import { EDITOR_TOKEN } from './test/worker/editor-token.ts'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))
  return {
    test: {
      projects: [
        {
          test: {
            name: 'unit',
            include: ['scripts/**/*.test.ts', 'shared/**/*.test.ts', 'worker/**/*.test.ts', 'src/**/*.test.ts'],
          },
        },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: './wrangler.jsonc' },
              remoteBindings: false,
              miniflare: {
                bindings: { EDITOR_TOKEN, TEST_MIGRATIONS: migrations },
              },
            }),
          ],
          test: {
            name: 'worker',
            include: ['test/worker/**/*.test.ts'],
            setupFiles: ['./test/worker/apply-migrations.ts'],
          },
        },
      ],
    },
  }
})
