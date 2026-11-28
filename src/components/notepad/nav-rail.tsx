'use client'

/**
 * V10.5 — desktop navigation rail (lg+ only): the hand-drawn "collapsible
 * notes pane". A fully-rounded vertical pill on the far left with the three
 * top-level destinations — Home, Notes, To revise — and a chevron that
 * hides/unhides the whole pane (the sketch's "<icon>, hide/unhide" note).
 *
 * Collapsed leaves a slim handle behind so the pane is one click away again;
 * the choice persists per device (prefs → navRailCollapsed). Hidden entirely
 * in editor focus modes, where the workspace fills the window.
 */
import { ChevronsRight, ChevronLeft, ChevronRight, House, NotebookText } from 'lucide-react'
import { usePrefsStore } from '@/lib/prefs'
import { cn } from '@/lib/utils'

export type AppScreen = 'home' | 'workspace' | 'revise'

interface NavRailProps {
  screen: AppScreen
  /** go to the home screen */
  onHome: () => void
  /** enter the notes workspace */
  onNotes: () => void
  /** open the To-revise hub */
  onRevise: () => void
  /** a focus mode hides all chrome */
  hidden?: boolean
  /** float over the Subjects pane (absolute, vertically centred) instead of
   *  taking its own column — the pane reserves the strip underneath */
  floating?: boolean
}

function RailButton({
  active,
  label,
  icon,
  onClick,
  testid,
}: {
  active: boolean
  label: string
  icon: React.ReactNode
  onClick: () => void
  testid: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-14 flex-col items-center gap-0.5 rounded-2xl px-1 py-2 text-[10px] font-semibold uppercase tracking-wide transition-colors',
        active
          ? 'bg-emerald-600 text-white shadow-sm'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {icon}
      <span className="leading-tight">{label}</span>
    </button>
  )
}

export function NavRail({ screen, onHome, onNotes, onRevise, hidden, floating }: NavRailProps) {
  const collapsed = usePrefsStore((s) => s.navRailCollapsed)
  const setCollapsed = usePrefsStore((s) => s.setNavRailCollapsed)

  if (hidden) return null

  if (collapsed) {
    return (
      <div
        className={cn(
          'hidden flex-col items-center lg:flex',
          floating
            ? 'absolute left-0 top-1/2 z-30 -translate-y-1/2'
            : 'shrink-0 py-2',
        )}
        data-testid="nav-rail-collapsed"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Show the navigation pane"
          title="Show the navigation pane"
          data-testid="nav-rail-expand"
          className="flex h-12 w-7 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <nav
      aria-label="Primary"
      data-testid="nav-rail"
      className={cn(
        'hidden flex-col items-center lg:flex',
        floating
          ? 'absolute left-2 top-1/2 z-30 -translate-y-1/2'
          : 'relative shrink-0 py-2',
      )}
    >
      <div
        className={cn(
          'flex flex-col items-center gap-1.5 rounded-full border bg-card px-1 py-4',
          floating ? 'bg-card/95 shadow-lg backdrop-blur' : 'shadow-sm',
        )}
      >
        <RailButton
          active={screen === 'home'}
          label="Home"
          testid="nav-rail-home"
          onClick={onHome}
          icon={<House className="h-5 w-5" aria-hidden />}
        />
        <RailButton
          active={screen === 'workspace'}
          label="Notes"
          testid="nav-rail-notes"
          onClick={onNotes}
          icon={<NotebookText className="h-5 w-5" aria-hidden />}
        />
        <RailButton
          active={screen === 'revise'}
          label="Revise"
          testid="nav-rail-revise"
          onClick={onRevise}
          icon={<ChevronsRight className="h-5 w-5" aria-hidden />}
        />
        <div className="mt-1 h-px w-8 bg-border" aria-hidden />
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Hide the navigation pane"
          title="Hide the navigation pane"
          data-testid="nav-rail-collapse"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </nav>
  )
}
