'use client'

import { useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Cloud,
  Gauge,
  House,
  RotateCcw,
  SlidersHorizontal,
  Type,
  type LucideIcon,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { isConfigured } from '@/lib/notepad/sync-backends'
import { setCloudEnabled, useSyncStore } from '@/lib/notepad/sync'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/hooks/use-media-query'
import { FONT_OPTIONS, SIZE_OPTIONS, usePrefsStore, useLowMemoryMode, type FontOption, type TabMode, type PerfMode, type HomeBatch } from '@/lib/prefs'

/** inline style so each picker row previews its own family */
const familyStyle = (opt: FontOption) =>
  opt.cssVar
    ? { fontFamily: `var(${opt.cssVar}), Georgia, serif` }
    : { fontFamily: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif' }

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Settings is organised into categories instead of one long list: sidebar +
 * content on md+ screens, a category list that opens into a single panel
 * (with a back button) on phones. Each category panel below keeps the exact
 * controls it had before — only the navigation around them is new.
 */
type SettingsCategory = 'font' | 'cloud' | 'optimisation' | 'home'

const CATEGORIES: {
  id: SettingsCategory
  label: string
  hint: string
  icon: LucideIcon
  tile: string
}[] = [
  {
    id: 'font',
    label: 'Font',
    hint: 'Family & note text size',
    icon: Type,
    tile: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
  {
    id: 'cloud',
    label: 'Cloud save',
    hint: 'Sync across your devices',
    icon: Cloud,
    tile: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  },
  {
    id: 'optimisation',
    label: 'Optimisation',
    hint: 'Tabs, performance & loading',
    icon: Gauge,
    tile: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  {
    id: 'home',
    label: 'Home screen',
    hint: 'Entry behaviour & all-notes list',
    icon: House,
    tile: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
]

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const font = usePrefsStore((s) => s.font)
  const noteSize = usePrefsStore((s) => s.noteSize)
  const tabMode = usePrefsStore((s) => s.tabMode)
  const optimiseMultiTabs = usePrefsStore((s) => s.optimiseMultiTabs)
  const continueFromLastNote = usePrefsStore((s) => s.continueFromLastNote)
  const perfMode = usePrefsStore((s) => s.perfMode)
  const homeShowAllNotes = usePrefsStore((s) => s.homeShowAllNotes)
  const homeBatch = usePrefsStore((s) => s.homeBatch)
  const setFont = usePrefsStore((s) => s.setFont)
  const setNoteSize = usePrefsStore((s) => s.setNoteSize)
  const setTabMode = usePrefsStore((s) => s.setTabMode)
  const setOptimiseMultiTabs = usePrefsStore((s) => s.setOptimiseMultiTabs)
  const setContinueFromLastNote = usePrefsStore((s) => s.setContinueFromLastNote)
  const setPerfMode = usePrefsStore((s) => s.setPerfMode)
  const setHomeShowAllNotes = usePrefsStore((s) => s.setHomeShowAllNotes)
  const setHomeBatch = usePrefsStore((s) => s.setHomeBatch)
  const resetPrefs = usePrefsStore((s) => s.resetPrefs)
  // the effective V10 optimisation state — Auto resolves against the device
  const lowMemory = useLowMemoryMode()
  const cloudOn = useSyncStore((s) => s.enabled)
  const cloudConfig = useSyncStore((s) => s.config)
  const cloudAccount = useSyncStore((s) => s.account)
  const cloudBusy = useSyncStore((s) => s.status === 'syncing')
  const openCloud = () => useSyncStore.getState().setDialogOpen(true)
  const toggleCloud = async (on: boolean) => {
    // no saved connection yet (or the stored session is gone) -> ask for the details
    if (on && !isConfigured(cloudConfig)) return openCloud()
    if (!(await setCloudEnabled(on))) openCloud()
  }

  // md+ gets the sidebar + content layout; smaller screens get the
  // category list -> panel flow. null = the mobile category list (on md+
  // the pane falls back to Font).
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [active, setActive] = useState<SettingsCategory | null>(null)
  // reopening starts from the top level on phones — adjusting state during
  // render (React's recommended reset-on-prop-change pattern)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setActive(null)
  }
  const current: SettingsCategory = active ?? 'font'
  const currentCat = CATEGORIES.find((c) => c.id === current) ?? CATEGORIES[0]

  // ---------- category panels (controls unchanged, only regrouped) ----------

  const fontPanel: ReactNode = (
    <>
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Font family
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/80">
          Applies across the app — code blocks stay monospaced.
        </p>
        <div
          className="mt-2 space-y-1"
          role="radiogroup"
          aria-label="App font"
        >
          {FONT_OPTIONS.map((opt) => {
            const selected = font === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setFont(opt.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                  selected
                    ? 'border-emerald-600/50 bg-emerald-600/5'
                    : 'border-transparent hover:bg-accent/50',
                )}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {selected && <Check className="h-4 w-4 text-emerald-600" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium" style={familyStyle(opt)}>
                    {opt.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {opt.hint}
                  </span>
                </span>
                <span
                  className="shrink-0 text-lg leading-none text-muted-foreground/70"
                  style={familyStyle(opt)}
                  aria-hidden
                >
                  Aa
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Note text size
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/80">
          Affects note content in the editor and the notes list.
        </p>
        <div
          className="mt-2 grid grid-cols-4 gap-1 rounded-lg bg-muted p-1"
          role="radiogroup"
          aria-label="Note text size"
        >
          {SIZE_OPTIONS.map((opt) => {
            const selected = noteSize === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setNoteSize(opt.id)}
                className={cn(
                  'rounded-md py-1.5 text-xs font-medium transition-colors',
                  selected
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        {/* live sample — inherits the chosen font + note text size */}
        <div className="mt-2 rounded-lg border bg-muted/30 p-3" aria-hidden>
          <p className="leading-relaxed text-foreground/90" style={{ fontSize: 'var(--note-font-size)' }}>
            Photosynthesis converts light energy into chemical energy, stored as glucose.
          </p>
          <p className="mt-1 font-bold tracking-tight" style={{ fontSize: 'calc(var(--note-h3-size) * 0.9)' }}>
            Heading sample
          </p>
        </div>
      </section>
    </>
  )

  const cloudPanel: ReactNode = (
    <section data-testid="cloud-save-section">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Connection</p>
      <p className="mt-0.5 text-xs text-muted-foreground/80">
        Sync notes to your own Supabase or Firebase project so every device shares them.
      </p>
      <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Cloud className="h-4 w-4" /> Save to cloud
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {cloudOn
              ? `${cloudConfig.provider === 'supabase' ? 'Supabase' : cloudConfig.provider === 'firebase' ? 'Firebase' : 'Server'}${cloudAccount ? ` · ${cloudAccount}` : ''}`
              : isConfigured(cloudConfig)
                ? 'Off — settings saved'
                : 'Not set up'}
          </p>
        </div>
        <Switch
          checked={cloudOn}
          disabled={cloudBusy}
          onCheckedChange={(on) => void toggleCloud(on)}
          aria-label="Cloud save"
          data-testid="cloud-save-switch"
        />
      </div>
      <Button variant="outline" size="sm" className="mt-2 w-full" onClick={openCloud} data-testid="cloud-save-configure">
        {isConfigured(cloudConfig) ? 'Update connection…' : 'Add connection…'}
      </Button>
    </section>
  )

  const optimisationPanel: ReactNode = (
    <>
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Note tabs
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/80">
          Multiple keeps a swappable tab bar for open notes below the app header.
        </p>
        <div
          className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
          role="radiogroup"
          aria-label="Note tabs mode"
        >
          {(
            [
              { id: 'single', label: 'Single tab', hint: 'One note at a time' },
              { id: 'multi', label: 'Multiple tabs', hint: 'Open several, swap freely' },
            ] as { id: TabMode; label: string; hint: string }[]
          ).map((opt) => {
            const selected = tabMode === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTabMode(opt.id)}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  selected
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
                <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground/80">
                  {opt.hint}
                </span>
              </button>
            )
          })}
        </div>

        {/* Optimise multi tabs — Yes/No, only meaningful with multiple tabs */}
        {tabMode === 'multi' && (
          <div className="mt-3" data-testid="optimise-multi-tabs-control">
            <p className="text-xs font-medium text-foreground/90">Optimise multi tabs</p>
            <p className="mt-0.5 text-xs text-muted-foreground/80">
              Yes mounts only the active tab’s editor and remembers each tab’s scroll
              position; No keeps every open tab loaded in RAM for the fastest switching.
            </p>
            <div
              className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
              role="radiogroup"
              aria-label="Optimise multi tabs"
            >
              {(
                [
                  { value: true, label: 'Yes', hint: 'One editor mounted — lighter RAM' },
                  { value: false, label: 'No', hint: 'All tabs loaded — fastest switch' },
                ] as { value: boolean; label: string; hint: string }[]
              ).map((opt) => {
                const selected = optimiseMultiTabs === opt.value
                return (
                  <button
                    key={opt.label}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setOptimiseMultiTabs(opt.value)}
                    data-testid={`optimise-multi-tabs-${opt.value ? 'yes' : 'no'}`}
                    className={cn(
                      'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                      selected
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {opt.label}
                    <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground/80">
                      {opt.hint}
                    </span>
                  </button>
                )
              })}
            </div>
            {/* V10 — the performance mode can force this on automatically */}
            {lowMemory && !optimiseMultiTabs && (
              <p className="mt-1.5 text-[11px] text-emerald-600" data-testid="optimise-multi-tabs-auto">
                Auto-enabled right now — Performance is optimising this device.
              </p>
            )}
          </div>
        )}
      </section>

      <section data-testid="performance-control">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Performance
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/80">
          Light mode for phones, tablets and ~2&nbsp;GB devices: the home all-notes list
          loads in batches and, with multiple tabs, only one editor stays in RAM.
        </p>
        <div
          className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
          role="radiogroup"
          aria-label="Performance mode"
        >
          {(
            [
              { id: 'auto', label: 'Auto', hint: 'Detect this device' },
              { id: 'yes', label: 'Yes', hint: 'Always optimise' },
              { id: 'no', label: 'No', hint: 'Full lists, fastest access' },
            ] as { id: PerfMode; label: string; hint: string }[]
          ).map((opt) => {
            const selected = perfMode === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPerfMode(opt.id)}
                data-testid={`perf-mode-${opt.id}`}
                className={cn(
                  'rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors',
                  selected
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
                <span className="mt-0.5 block text-[10px] font-normal leading-tight text-muted-foreground/80">
                  {opt.hint}
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground/80" data-testid="perf-effective">
          {lowMemory
            ? 'Optimisations are active on this device right now.'
            : 'Optimisations are off — everything loads at once, fastest access.'}
        </p>
      </section>

      <section data-testid="home-batch-control">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Home notes per batch
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/80">
          While optimising, the home all-notes list mounts this many notes at a time and
          loads more as you scroll. Optimisations off shows the whole list at once.
        </p>
        <div
          className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
          role="radiogroup"
          aria-label="Home notes per batch"
        >
          {(
            [
              { value: 10, label: '10', hint: 'Lightest on RAM' },
              { value: 20, label: '20', hint: 'Fewer loads while scrolling' },
            ] as { value: HomeBatch; label: string; hint: string }[]
          ).map((opt) => {
            const selected = homeBatch === opt.value
            return (
              <button
                key={opt.label}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setHomeBatch(opt.value)}
                data-testid={`home-batch-${opt.value}`}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  selected
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
                <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground/80">
                  {opt.hint}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </>
  )

  const homePanel: ReactNode = (
    <>
      <section data-testid="continue-last-note-control">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Continue from last note
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/80">
          Yes opens your last-opened note right away when you enter; No shows the home
          screen (&ldquo;Pick up where you left off&rdquo;) first.
        </p>
        <div
          className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
          role="radiogroup"
          aria-label="Continue from last note"
        >
          {(
            [
              { value: true, label: 'Yes', hint: 'Open the last note directly' },
              { value: false, label: 'No', hint: 'Home screen first' },
            ] as { value: boolean; label: string; hint: string }[]
          ).map((opt) => {
            const selected = continueFromLastNote === opt.value
            return (
              <button
                key={opt.label}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setContinueFromLastNote(opt.value)}
                data-testid={`continue-last-note-${opt.value ? 'yes' : 'no'}`}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  selected
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
                <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground/80">
                  {opt.hint}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section data-testid="home-show-all-notes-control">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Show all notes on home
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/80">
          Yes adds a searchable list of every note under the top-5 picks (scroll to load
          more); No keeps the home screen minimal.
        </p>
        <div
          className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
          role="radiogroup"
          aria-label="Show all notes on home"
        >
          {(
            [
              { value: true, label: 'Yes', hint: 'Searchable all-notes list' },
              { value: false, label: 'No', hint: 'Just the top-5 picks' },
            ] as { value: boolean; label: string; hint: string }[]
          ).map((opt) => {
            const selected = homeShowAllNotes === opt.value
            return (
              <button
                key={opt.label}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setHomeShowAllNotes(opt.value)}
                data-testid={`home-show-all-notes-${opt.value ? 'yes' : 'no'}`}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  selected
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
                <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground/80">
                  {opt.hint}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </>
  )

  const panels: Record<SettingsCategory, ReactNode> = {
    font: fontPanel,
    cloud: cloudPanel,
    optimisation: optimisationPanel,
    home: homePanel,
  }

  // ---------- chrome pieces shared across the three layouts ----------

  const rootHeader = (
    <div className="border-b px-5 py-4 pr-14">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base">
          <SlidersHorizontal className="h-4 w-4 text-emerald-600" /> Settings
        </DialogTitle>
        <DialogDescription className="text-xs">
          Reading preferences for this browser — saved automatically.
        </DialogDescription>
      </DialogHeader>
    </div>
  )

  // sidebar rows keep a live selection highlight; the phone's top-level list
  // renders selection-neutral since no panel is open there
  const categoryButtons = (showSelection: boolean) =>
    CATEGORIES.map((cat) => {
      const selected = showSelection && cat.id === current
      const Icon = cat.icon
      return (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActive(cat.id)}
            data-testid={`settings-category-${cat.id}`}
            aria-current={selected ? 'true' : undefined}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors',
              selected
                ? 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                selected ? cat.tile : 'bg-muted text-muted-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">{cat.label}</span>
            <ChevronRight
              className={cn('h-4 w-4 shrink-0 transition-opacity', selected ? 'opacity-60' : 'opacity-30')}
              aria-hidden
            />
          </button>
        )
      })

  const footer = (
    <DialogFooter className="items-center justify-between gap-2 border-t px-5 py-3">
      <p className="text-[11px] text-muted-foreground">Stored locally, like your notes.</p>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={resetPrefs}
      >
        <RotateCcw className="h-3.5 w-3.5" /> Reset
      </Button>
    </DialogFooter>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {isDesktop ? (
          <>
            {rootHeader}
            {/* sidebar + content on md+ */}
            <div className="flex min-h-0 flex-1">
              <nav
                className="flex w-48 shrink-0 flex-col gap-1 border-r bg-muted/40 p-2"
                aria-label="Settings categories"
              >
                {categoryButtons(true)}
              </nav>
              <div
                className="min-h-0 flex-1 overflow-y-auto p-5"
                data-testid={`settings-pane-${current}`}
              >
                <div className="space-y-6">{panels[current]}</div>
              </div>
            </div>
          </>
        ) : active === null ? (
          <>
            {rootHeader}
            {/* category list first on phones */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="settings-category-list">
              <div className="space-y-2">{categoryButtons(false)}</div>
            </div>
          </>
        ) : (
          <>
            {/* opened panel with a way back on phones */}
            <div className="border-b px-3 py-3 pr-14">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setActive(null)}
                  aria-label="Back to settings categories"
                  data-testid="settings-back"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </Button>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                        currentCat.tile,
                      )}
                    >
                      <currentCat.icon className="h-4 w-4" aria-hidden />
                    </span>
                    {currentCat.label}
                  </DialogTitle>
                  <DialogDescription className="text-xs">{currentCat.hint}</DialogDescription>
                </DialogHeader>
              </div>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto p-4"
              data-testid={`settings-pane-${current}`}
            >
              <div className="space-y-6">{panels[current]}</div>
            </div>
          </>
        )}
        {footer}
      </DialogContent>
    </Dialog>
  )
}
