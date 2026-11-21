'use client'

import { useEffect, useRef, useState } from 'react'
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
 * Keyed shell-first mounting — the note-surface flavour of `useDeferredMount`.
 *
 * Same idea as above, but the gate is keyed to a SURFACE IDENTITY (a note id)
 * instead of a boolean, which the editor needs for two reasons:
 *
 * 1. Opening a note (from home, from a note switch, a fresh tab) used to run
 *    the whole markdown+KaTeX pipeline inside the click's own commit — with
 *    several persisted tabs the multi-tab grid ran one pipeline per tab and a
 *    single click froze the app for 1-2s. Keying the pane's body on the note
 *    id makes the chrome (top bar, toolbar, title) paint in the click's frame
 *    while the heavy body mounts two frames later behind a "Loading note…"
 *    stand-in.
 * 2. The optional `delayMs` staggers background panes: in the multi-tab grid
 *    every persisted tab mounts its own editor, and without a stagger they
 *    would ALL land in the same (later) commit — the freeze would merely move
 *    two frames down. The active pane loads at once; hidden ones follow at
 *    `delayMs` intervals so each build gets its own slice of the main thread.
 *
 * `delayMs` is read at (re)arm time only and deliberately NOT a dependency:
 * a background pane that becomes active must not re-gate, or switching to an
 * already-built tab would flash a pointless spinner.
 */
export function useDeferredSurface(
  key: string | null | undefined,
  delayMs = 0,
): boolean {
  const [ready, setReady] = useState(false)
  // reset in the SAME render when the surface identity changes — the render
  // -phase adjust guarantees the heavy subtree never enters that commit
  // (an effect-based reset would run AFTER the expensive commit has painted)
  const prevKeyRef = useRef<string | null | undefined>(key)
  if (prevKeyRef.current !== key) {
    prevKeyRef.current = key
    if (ready) setReady(false)
  }
  const delayRef = useRef(delayMs)
  delayRef.current = delayMs

  useEffect(() => {
    if (key == null) return
    let raf1 = 0
    let raf2 = 0
    let timer: number | undefined = undefined
    const arm = () => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setReady(true))
      })
    }
    const d = delayRef.current
    if (d > 0) timer = window.setTimeout(arm, d)
    else arm()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [key])

  return ready && key != null
}

/**
 * Loading stand-in shown while a deferred surface builds itself.
 * `keep-anim` keeps the spinner spinning even when the Animations setting
 * is off (same convention as the header sync badge).
 */
export function DeferredLoading({
  label = 'Loading…',
  className,
  testId = 'deferred-loading',
}: {
  label?: string
  className?: string
  /** override the probe id — distinct stand-ins (note body vs dialogs) get
   *  their own data-testid so E2E can tell them apart */
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
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
