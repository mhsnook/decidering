import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { TrackerProvider } from '../lib/tracker.tsx'
import { isEditor } from '../lib/editor.ts'
import { Logo } from '../components/bits.tsx'

export const Route = createRootRoute({ component: Root })

function NavLinks({ className, onNavigate }: { className: string; onNavigate?: () => void }) {
  return (
    <>
      <Link to="/questions" className={className} onClick={onNavigate}>
        Questions
      </Link>
      <Link to="/" hash="how" className={className} activeProps={{}} onClick={onNavigate}>
        How it works
      </Link>
      <Link to="/" hash="own" className={className} activeProps={{}} onClick={onNavigate}>
        Run your own
      </Link>
      <Link to="/editor" className={className} onClick={onNavigate}>
        {isEditor() ? 'Review queue' : 'Editors'}
      </Link>
    </>
  )
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <header className="-mx-5 border-b-2 border-ink px-5 sm:-mx-8 sm:px-8">
      <div className="flex items-center justify-between gap-4 py-4 sm:py-6">
        <Link to="/" className="flex items-center gap-2.5 sm:gap-3" onClick={() => setMenuOpen(false)}>
          <Logo />
          <span className="font-display text-xl font-black sm:text-2xl">Sporelight</span>
        </Link>
        <nav className="hidden items-center gap-1 text-[15px] font-semibold md:flex">
          <NavLinks className="rounded-full px-3.5 py-2 hover:text-accent [&.active]:bg-ink [&.active]:text-paper" />
        </nav>
        <button type="button" className="btn px-3 text-sm font-bold shadow-none md:hidden" aria-expanded={menuOpen} aria-controls="menu" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </div>
      {menuOpen && (
        <nav id="menu" className="flex flex-col pb-3 text-lg font-bold md:hidden">
          <NavLinks className="flex min-h-11 items-center border-t-2 border-dashed border-line [&.active]:text-accent" onNavigate={() => setMenuOpen(false)} />
        </nav>
      )}
    </header>
  )
}

function Root() {
  return (
    <TrackerProvider>
      <div className="mx-auto flex min-h-dvh max-w-[1200px] flex-col px-5 sm:px-8">
        <Header />
        <main className="flex-1 py-8">
          <Outlet />
        </main>
        <footer className="-mx-5 mt-10 flex flex-wrap justify-between gap-2 border-t-2 border-ink px-5 py-5 text-[15px] sm:-mx-8 sm:px-8">
          <span>Every position links to its source.</span>
          <span className="tag">Open source · MIT licence</span>
        </footer>
      </div>
    </TrackerProvider>
  )
}
