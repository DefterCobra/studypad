'use client'

import { useEffect, useState } from 'react'

/**
 * Height (px) of the on-screen keyboard, 0 when none.
 *
 * Derived from the Visual Viewport API: the layout viewport
 * (`window.innerHeight`) keeps its full height on both iOS Safari and
 * Android Chrome while the keyboard shrinks the *visual* viewport, so the
 * gap between the visible bottom edge and the layout bottom edge is exactly
 * the keyboard inset. `offsetTop` accounts for pinch-zoom pans. Updates ride
 * the viewport's `resize`/`scroll` events through one rAF, so the value
 * tracks the keyboard sliding in, the user panning, and rotation.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let raf = 0
    const update = () => {
      raf = 0
      setInset(Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height)))
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule) // orientation / URL-bar changes
    return () => {
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return inset
}
