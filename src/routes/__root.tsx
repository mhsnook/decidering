import { Link, Outlet, createRootRoute, retainSearchParams } from '@tanstack/react-router'
import { TrackerProvider } from '../lib/tracker.tsx'
import { isEditor } from '../lib/editor.ts'

// `as` is the day every body is viewed on, and `body` the one a question put
// to several is viewed through. Both are kept across links, so a reader stays
// in the view they chose until they switch back.
export const Route = createRootRoute({
  component: Root,
  validateSearch: (s: Record<string, unknown>): { as?: string; body?: string } => ({
    as: typeof s.as === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.as) ? s.as : undefined,
    body: typeof s.body === 'string' && s.body ? s.body : undefined,
  }),
  search: { middlewares: [retainSearchParams(['as', 'body'])] },
})

function Root() {
  const { as } = Route.useSearch()
  return (
    <TrackerProvider asOf={as}>
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6">
        <header className="flex items-baseline justify-between border-b border-line py-4">
          <Link to="/" className="font-display text-xl font-semibold tracking-tight">
            Decidering
          </Link>
          <nav className="flex gap-4 text-sm text-muted">
            <Link to="/" className="hover:text-ink [&.active]:text-ink">
              Questions
            </Link>
            <Link to="/editor" className="hover:text-ink [&.active]:text-ink">
              {isEditor() ? 'Review queue' : 'Editors'}
            </Link>
          </nav>
        </header>
        <main className="flex-1 py-8">
          <Outlet />
        </main>
        <footer className="border-t border-line py-6 text-xs text-muted">
          Every position here links to its source. Spot something missing or out of date? Open the person's page and send it in.
        </footer>
      </div>
    </TrackerProvider>
  )
}
