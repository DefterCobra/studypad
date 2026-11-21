'use client'

import { useRef } from 'react'
import { useNotepadStore } from '@/lib/notepad/store'
import { useAnimationsEnabled, useLowMemoryMode, usePrefsStore } from '@/lib/prefs'
import { cn } from '@/lib/utils'
import { EditorPane, type EditorPaneProps } from './editor-pane'

/**
 * Mount strategy for the note editor (V8.6 — "Optimise multi tabs", extended
 * in V10, animated in V10.3).
 *
 * - Single-tab mode: one editor bound to the store's selected note (unchanged).
 * - Multiple tabs + Optimise = Yes: only the active note's editor is mounted;
 *   every switch unmounts/remounts, with the outgoing note's scroll offset
 *   remembered and the incoming one replayed (scroll-memory.ts). Lighter on
 *   RAM with many tabs, at the cost of a short re-render per switch.
 * - Multiple tabs + Optimise = No (default): every open tab's editor stays
 *   mounted, stacked on top of each other with visibility:hidden — layout,
 *   KaTeX and scroll offsets all stay alive in RAM, so switching is instant.
 *   display:none is deliberately avoided because it zeroes scroll positions.
 * - V10: the low-memory mode (Settings → Performance, Auto-detected on
 *   phones / tablets / ~2 GB devices) turns the optimised mounting on even
 *   when the Yes/No switch itself is still on No.
 * - V10.3: switching tabs slides the incoming editor in the direction of the
 *   tab it came from (higher index → from the right, lower → from the left),
 *   unless Animations are off. In the stacked path the class lands on the
 *   pane that just became active; re-gaining it replays the animation.
 * - V10.3.6: every pane's BODY mounts shell-first behind a "Loading note…"
 *   stand-in (see editor-pane), and the hidden panes are staggered 80ms
 *   apart — opening the workspace with several persisted tabs used to run
 *   one markdown+KaTeX pipeline per tab inside the click's single commit,
 *   which froze the app for 1-2s. Now the active pane builds first and each
 *   background tab gets its own slice of the main thread.
 */
export function MultiEditorPane(props: EditorPaneProps) {
  const tabMode = usePrefsStore((s) => s.tabMode)
  const optimiseSetting = usePrefsStore((s) => s.optimiseMultiTabs)
  const lowMemory = useLowMemoryMode()
  const openNoteIds = useNotepadStore((s) => s.openNoteIds)
  const selectedNoteId = useNotepadStore((s) => s.selectedNoteId)
  const animsOn = useAnimationsEnabled()

  // direction of the current switch, from the tab indexes — remember the
  // previous active index in a ref adjusted during render (React's
  // keep-previous-value pattern; StrictMode's double render is harmless:
  // the second pass sees the same index and keeps the fallback)
  const prevIndexRef = useRef<number | null>(null)
  const index = selectedNoteId ? openNoteIds.indexOf(selectedNoteId) : -1
  const prevIndex = prevIndexRef.current
  const dir: 'left' | 'right' =
    prevIndex !== null && prevIndex >= 0 && index >= 0 && index !== prevIndex
      ? index > prevIndex
        ? 'right'
        : 'left'
      : 'right'
  if (index !== prevIndex) prevIndexRef.current = index

  const slideClass = animsOn
    ? dir === 'left'
      ? 'anim-slide-in-left'
      : 'anim-slide-in-right'
    : undefined

  // the performance mode overrides the No — memory wins on small devices
  const optimise = optimiseSetting || lowMemory
  if (tabMode !== 'multi') {
    return <EditorPane {...props} />
  }

  if (optimise) {
    // key by note id — a fresh editor per note, scroll replayed on mount;
    // the wrapper carries the slide entrance for the incoming note
    return (
      <div
        key={selectedNoteId ?? 'none'}
        className={cn('h-full min-h-0', slideClass)}
        data-testid="editor-slide"
      >
        <EditorPane scrollMemory {...props} />
      </div>
    )
  }

  // the selected note always gets a pane, even if its tab was just closed
  const ids =
    selectedNoteId && !openNoteIds.includes(selectedNoteId)
      ? [...openNoteIds, selectedNoteId]
      : openNoteIds

  // per-pane body-build delay: the active pane at once, hidden panes 80ms
  // apart in tab order — see the V10.3.6 note in the header comment
  const bodyDelays = new Map<string, number>()
  let hiddenSeen = 0
  for (const id of ids) {
    bodyDelays.set(id, id === selectedNoteId ? 0 : ++hiddenSeen * 80)
  }

  if (ids.length === 0) {
    return <EditorPane key="none" {...props} />
  }

  return (
    <div className="relative h-full min-h-0" data-testid="multi-editor-grid">
      {ids.map((id) => {
        const active = id === selectedNoteId
        return (
          <div
            key={id}
            className={cn('absolute inset-0', active && slideClass)}
            style={{
              // visibility (not display) keeps scroll offsets and KaTeX alive
              visibility: active ? 'visible' : 'hidden',
              pointerEvents: active ? undefined : 'none',
            }}
            aria-hidden={!active}
            data-testid={`editor-pane-for-${id}`}
          >
            <EditorPane {...props} noteId={id} bodyLoadingDelay={bodyDelays.get(id) ?? 0} />
          </div>
        )
      })}
    </div>
  )
}
