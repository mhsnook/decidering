import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'

export function Modal({
  open,
  onClose,
  title,
  description,
  keepMounted = false,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  // Keeps a half-written form alive through an accidental dismissal.
  keepMounted?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function onMouseDown(e: MouseEvent<HTMLDialogElement>) {
    if (e.target !== ref.current) return
    const box = ref.current.getBoundingClientRect()
    const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom
    if (outside) onClose()
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onMouseDown={onMouseDown}
      // Tailwind's reset zeroes the margin that centres a native dialog. Leave
      // position alone: the browser's `fixed` is what keeps it in the viewport.
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-line bg-paper p-5 text-ink shadow-2xl backdrop:bg-black/60 sm:p-6"
    >
      <h2 className="pr-8 text-xl font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4">{(open || keepMounted) && children}</div>
      {/* After the content, so showModal() puts focus on the first field rather than here. */}
      <button type="button" aria-label="Close" onClick={onClose} className="absolute top-3 right-3 grid size-8 place-items-center rounded-md text-xl leading-none text-muted hover:bg-surface hover:text-ink">
        ×
      </button>
    </dialog>
  )
}
