// The test-only binding vitest.config.ts adds. wrangler types declares Env twice,
// globally and in Cloudflare, so both are widened.
interface TestBindings {
  TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
}
interface Env extends TestBindings {}
declare namespace Cloudflare {
  interface Env extends TestBindings {}
}
