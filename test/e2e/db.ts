import { execFileSync } from 'node:child_process'

// Reads the same local D1 the dev server serves, so the flows can check the
// page against the data rather than against numbers copied from the seed.
export function query<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  return (JSON.parse(out) as { results: T[] }[])[0].results
}
