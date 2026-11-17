import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['scripts/**/*.test.ts', 'shared/**/*.test.ts', 'worker/**/*.test.ts', 'src/**/*.test.ts'] } })
