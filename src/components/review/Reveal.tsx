import type { ReactNode } from 'react'

// Opens and closes its content by growing the row it sits in, so what follows
// moves with it and nothing jumps.
export function Reveal({ open, children, className = '' }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'} ${className}`} inert={!open}>
      {/* The side padding leaves room for focus rings and hard shadows, which the clipping would cut. */}
      <div className="-mx-1.5 min-h-0 overflow-hidden px-1.5">{children}</div>
    </div>
  )
}
