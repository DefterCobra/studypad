'use client'

/**
 * V10.5 — mobile bottom navigation (sketch: home, notes, search, more) as a
 * floating fully-rounded pill (the "[FULL ROUND TOP AND BOTTOM]" note).
 *
 * Hidden while typing, per the sketch's "ON MOBILE WHILE TYPING HIDE THIS":
 * both signals count — a non-zero keyboard inset (VisualViewport, real
 * on-screen keyboards) or any text field holding focus (also testable on
 * desktop emulation). It slides away with translate/opacity, never unmounts,
 * so tab order and testids stay stable. Hidden with the rest of the chrome
 * in editor focus modes.
 */
import { useEffect, useState } from 'react'
import { ChevronsRight, House, NotebookText, Search } from 'lucide-react'
import { useKeyboardInset } from '@/hooks/use-keyboard-inset'
import { cn } from '@/lib/utils'
import type { AppScreen } from './nav-rail'

interface BottomNavProps {
  screen: AppScreen
  onHome: () => void
  onNotes: () => void
  onSearch: () => void
  onMore: () => void
  /** a focus mode hides all chrome */
  hidden?: boolean
}

/** true when the focused element is something the user types into */
function isTextField(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}

export function BottomNav({ screen, onHome, onNotes, onSearch, onMore, hidden }: BottomNavProps) {
  const kbInset = useKeyboardInset()
  const [typing, setTyping] = useState(false)

  // track text-field focus — together with the keyboard inset this is the
  // "while typing" signal that hides the pill (works in every browser)
  useEffect(() => {
    const check = () => setTyping(isTextField(document.activeElement))
    check()
    document.addEventListener('focusin', check)
    document.addEventListener('focusout', check)
    return () => {
      document.removeEventListener('focusin', check)
      document.removeEventListener('focusout', check)
    }
  }, [])

  const keyboardHidden = kbInset > 0 || typing

  return (
    <nav
      aria-label="Primary"
      data-testid="bottom-nav"
      data-keyboard-hidden={keyboardHidden ? 'true' : 'false'}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex justify-center transition-all duration-200 ease-out lg:hidden',
        (keyboardHidden || hidden) &&
          'pointer-events-none translate-y-full opacity-0',
      )}
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      inert={keyboardHidden || hidden}
    >
      <div className="flex items-center gap-1 rounded-full border bg-card/95 px-2.5 py-1.5 shadow-lg backdrop-blur">
        <NavButton
          active={screen === 'home'}
          label="Home"
          testid="bottom-nav-home"
          onClick={onHome}
          icon={<House className="h-5 w-5" aria-hidden />}
        />
        <NavButton
          active={screen === 'workspace'}
          label="Notes"
          testid="bottom-nav-notes"
          onClick={onNotes}
          icon={<NotebookText className="h-5 w-5" aria-hidden />}
        />
        <NavButton
          active={false}
          label="Search"
          testid="bottom-nav-search"
          onClick={onSearch}
          icon={<Search className="h-5 w-5" aria-hidden />}
        />
        <NavButton
          active={screen === 'revise'}
          label="More"
          testid="bottom-nav-more"
          onClick={onMore}
          icon={<ChevronsRight className="h-5 w-5" aria-hidden />}
        />
      </div>
    </nav>
  )
}

function NavButton({
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
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-11 min-w-14 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-[9px] font-semibold uppercase tracking-wide transition-colors',
        active
          ? 'bg-emerald-600 text-white shadow-sm'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {icon}
      <span className="leading-none">{label}</span>
    </button>
  )
}
