/**
 * Workspace appearance preferences (font family + note text size).
 *
 * Kept separate from the notepad store on purpose: these are per-browser UI
 * preferences, not user data — they never belong in backup exports. Persisted
 * to localStorage synchronously so the tiny boot script in layout.tsx can
 * apply them before first paint (no font flash on reload).
 */
import { useState } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type FontId = 'default' | 'literata' | 'lora' | 'merriweather' | 'source-serif'
export type NoteSizeId = 'sm' | 'md' | 'lg' | 'xl'
export type TabMode = 'single' | 'multi'

/** performance mode: Auto detects the device, Yes forces the light mode,
 *  No turns everything off for instant full-list access */
export type PerfMode = 'auto' | 'yes' | 'no'
/** animations mode (V10.3): Auto enables them unless the device looks low-end
 *  or the OS asks for reduced motion; Yes always animates; No kills every
 *  animation and transition for instant switches */
export type AnimMode = PerfMode
/** how many notes the home screen's all-notes list loads per batch */
export type HomeBatch = 10 | 20

export interface FontOption {
  id: FontId
  label: string
  /** css variable created by next/font in layout.tsx (undefined = app default) */
  cssVar?: string
  hint: string
}

/** 4 book serifs + the current app font as default */
export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'default',
    label: 'Default',
    hint: 'Geist — the current app font',
  },
  {
    id: 'literata',
    label: 'Literata',
    cssVar: '--font-literata',
    hint: 'Designed for long-form e-book reading',
  },
  {
    id: 'lora',
    label: 'Lora',
    cssVar: '--font-lora',
    hint: 'Contemporary serif with a brushy feel',
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    cssVar: '--font-merriweather',
    hint: 'Sturdy serif built for screens',
  },
  {
    id: 'source-serif',
    label: 'Source Serif',
    cssVar: '--font-source-serif',
    hint: 'Clear print-inspired serif',
  },
]

export const SIZE_OPTIONS: { id: NoteSizeId; label: string }[] = [
  { id: 'sm', label: 'Small' },
  { id: 'md', label: 'Default' },
  { id: 'lg', label: 'Large' },
  { id: 'xl', label: 'X-Large' },
]

interface PrefsState {
  font: FontId
  noteSize: NoteSizeId
  /** single = one note at a time (no tab bar); multi = swappable tab bar */
  tabMode: TabMode
  /** multi-tab optimisation: Yes mounts only the active tab's editor
   *  (memory-friendly, scroll positions remembered); No keeps every open
   *  tab's editor alive in RAM for the fastest possible switching */
  optimiseMultiTabs: boolean
  /** Yes: entering the app opens the last-opened note straight away (V9.0
   *  home screen is skipped); No (default): the home screen comes first */
  continueFromLastNote: boolean
  /** V10 performance mode (default Auto): phones / tablets / ~2 GB devices get
   *  the light mode automatically — batched home list + single-editor tabs */
  perfMode: PerfMode
  /** Yes (default): the home screen shows the searchable all-notes list under
   *  the top-5 picks; No keeps the home screen minimal (fastest render) */
  homeShowAllNotes: boolean
  /** batch size for the home all-notes list while optimising (default 10) */
  homeBatch: HomeBatch
  /** V10.3 UI animations (default Auto): slide/fade transitions for tab
   *  switching and the home ↔ workspace swap — Auto disables them on low-end
   *  devices (≤2 GB RAM) and for prefers-reduced-motion users */
  animations: AnimMode
  /** V10.5 — the desktop navigation rail (Home / Notes / To revise) is
   *  collapsed to its show-handle (per-device UI pref, not user data) */
  navRailCollapsed: boolean
  setFont: (font: FontId) => void
  setNoteSize: (size: NoteSizeId) => void
  setTabMode: (mode: TabMode) => void
  setOptimiseMultiTabs: (value: boolean) => void
  setContinueFromLastNote: (value: boolean) => void
  setPerfMode: (mode: PerfMode) => void
  setHomeShowAllNotes: (value: boolean) => void
  setHomeBatch: (size: HomeBatch) => void
  setAnimations: (mode: AnimMode) => void
  setNavRailCollapsed: (value: boolean) => void
  resetPrefs: () => void
}

/**
 * Best-effort "this device probably has little RAM" probe (V10).
 *
 * Signals, strongest first:
 * - Device Memory API (`navigator.deviceMemory`, Chrome/Android): ~2 GB or less
 * - Data Saver on (`navigator.connection.saveData`)
 * - A classic phone/tablet UA string (iPhone, iPad, Android, Mobile, Tablet…)
 * - Touch input + a small viewport (iPads, which report a desktop UA)
 *
 * Desktops and laptops (desktop UA, no touch, no low-RAM report) stay
 * unoptimised so the home screen renders every note at once — the fastest
 * possible access. iPad Pro's 12.9" (Macintosh UA, big viewport, no RAM
 * report) is the one deliberate miss: it ships with 4-6 GB anyway.
 */
export function deviceLooksLowMemory(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { saveData?: boolean }
  }
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory <= 2) return true
  if (nav.connection?.saveData) return true
  // phones & tablets — on real hardware touch always accompanies these UAs,
  // so the UA match alone is a reliable form-factor signal
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|PlayBook/i.test(nav.userAgent ?? '')) return true
  const touch = nav.maxTouchPoints > 0
  if (touch && typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 820) {
    return true
  }
  return false
}

/**
 * Effective "optimise for this device" flag: Yes forces it on, No forces it
 * off, Auto applies the device detection above. Consumers: the home screen's
 * batched all-notes list and the multi-tab single-editor mounting.
 */
export function useLowMemoryMode(): boolean {
  const perfMode = usePrefsStore((s) => s.perfMode)
  // resolved once per mount — the device form factor never changes mid-session
  const [detected] = useState(() => deviceLooksLowMemory())
  if (perfMode === 'yes') return true
  if (perfMode === 'no') return false
  return detected
}

/**
 * "This device probably shouldn't animate" probe (V10.3).
 *
 * Auto mode disables the UI animations here — the user asked for a RAM rule:
 * ≤2 GB devices skip every slide/fade. The OS-level prefers-reduced-motion
 * signal (accessibility: "I don't want motion") also opts out in Auto.
 */
export function deviceLooksLowEnd(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { deviceMemory?: number }
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory <= 2) return true
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true
  } catch {
    /* very old browsers — treat as capable */
  }
  return false
}

/** pure resolver so non-hook contexts (the DOM applier, the boot script)
 *  and hooks share one rule */
export function resolveAnimationsEnabled(mode: AnimMode, lowEnd: boolean): boolean {
  if (mode === 'yes') return true
  if (mode === 'no') return false
  return !lowEnd
}

/**
 * Effective "play the UI animations" flag — Yes forces them on, No turns them
 * all off, Auto enables them unless deviceLooksLowEnd() matched.
 */
export function useAnimationsEnabled(): boolean {
  const animations = usePrefsStore((s) => s.animations)
  // resolved once per mount — neither RAM nor the OS motion setting changes mid-session
  const [lowEnd] = useState(() => deviceLooksLowEnd())
  return resolveAnimationsEnabled(animations, lowEnd)
}

/** SSR-safe storage: the server render never touches localStorage */
const storage = () =>
  typeof window === 'undefined'
    ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    : window.localStorage

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      font: 'default',
      noteSize: 'md',
      tabMode: 'single',
      optimiseMultiTabs: false,
      continueFromLastNote: false,
      perfMode: 'auto',
      homeShowAllNotes: true,
      homeBatch: 10,
      animations: 'auto',
      navRailCollapsed: false,
      setFont: (font) => set({ font }),
      setNoteSize: (noteSize) => set({ noteSize }),
      setTabMode: (tabMode) => set({ tabMode }),
      setOptimiseMultiTabs: (optimiseMultiTabs) => set({ optimiseMultiTabs }),
      setContinueFromLastNote: (continueFromLastNote) => set({ continueFromLastNote }),
      setPerfMode: (perfMode) => set({ perfMode }),
      setHomeShowAllNotes: (homeShowAllNotes) => set({ homeShowAllNotes }),
      setHomeBatch: (homeBatch) => set({ homeBatch }),
      setAnimations: (animations) => set({ animations }),
      setNavRailCollapsed: (navRailCollapsed) => set({ navRailCollapsed }),
      resetPrefs: () =>
        set({
          font: 'default',
          noteSize: 'md',
          tabMode: 'single',
          optimiseMultiTabs: false,
          continueFromLastNote: false,
          perfMode: 'auto',
          homeShowAllNotes: true,
          homeBatch: 10,
          animations: 'auto',
          navRailCollapsed: false,
        }),
    }),
    {
      name: 'studypad-prefs-v1',
      storage: createJSONStorage(storage),
    },
  ),
)
