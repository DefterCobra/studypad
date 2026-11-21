'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Shell-first mounting for heavy surfaces (dialogs, the reading view).
 *
 * The interaction problem this solves: mounting an expensive subtree in the
 * same commit as the click freezes the frame until everything is built — one
 * click can visibly "do nothing" for seconds. Instead the shell (dialog
 * frame, title, tabs, settings column…) paints in the click's own frame,
 * while the expensive subtree mounts two frames later, behind a loading
 * stand-in. The click never pays the heavy cost up front, and the surface
 * FEELS instant even though the work still happens.
 *
 * Returns `ready`: false until two frames after `open` turned true — gate the
 * expensive subtree on it and render <DeferredLoading> while it is false.
 * Closing (or a close mid-build) resets it, so every reopen goes through the
 * same shell-first path instead of dropping the whole pipeline back into a
 * click's frame.
 */
export function useDeferredMount(open: boolean): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) return
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setReady(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [open])

  useEffect(() => {
    if (open) return
    setReady(false)
  }, [open])

  return ready
}

/**
 * Loading stand-in shown while a deferred surface builds itself.
 * `keep-anim` keeps the spinner spinning even when the Animations setting
 * is off (same convention as the header sync badge).
 */
export function DeferredLoading({
  label = 'Loading…',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      data-testid="deferred-loading"
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-1 items-center justify-center gap-2 py-12 text-sm text-muted-foreground',
        className,
      )}
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin keep-anim" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
