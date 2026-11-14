'use client'

import { useEffect, useState } from 'react'
import { deviceLooksLowEnd, resolveAnimationsEnabled, usePrefsStore } from '@/lib/prefs'

/**
 * Keeps <html data-app-font / data-note-size / no-anim> in sync with the
 * saved prefs. globals.css reads these attributes and classes; the pre-paint
 * boot script in layout.tsx covers reloads, this covers live changes (and the
 * very first visit, where both stay at their defaults).
 */
export function PrefsApplier() {
  const font = usePrefsStore((s) => s.font)
  const noteSize = usePrefsStore((s) => s.noteSize)
  const animations = usePrefsStore((s) => s.animations)
  // resolved once per mount — the device profile never changes mid-session
  const [lowEnd] = useState(() => deviceLooksLowEnd())

  useEffect(() => {
    const el = document.documentElement
    if (font === 'default') el.removeAttribute('data-app-font')
    else el.setAttribute('data-app-font', font)
    if (noteSize === 'md') el.removeAttribute('data-note-size')
    else el.setAttribute('data-note-size', noteSize)
    // Animations: No (or Auto on a low-end device) adds the kill switch class
    el.classList.toggle('no-anim', !resolveAnimationsEnabled(animations, lowEnd))
  }, [font, noteSize, animations, lowEnd])

  return null
}
