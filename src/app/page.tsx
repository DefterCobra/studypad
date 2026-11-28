'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArchiveRestore,
  BookOpen,
  CheckCircle2,
  Cloud,
  CloudAlert,
  CloudOff,
  Database,
  Download,
  FileArchive,
  FileUp,
  GraduationCap,
  HardDrive,
  LayoutGrid,
  Loader2,
  Pin,
  PinOff,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useNotepadStore, useSelectedNote, resetPadToSeeds } from '@/lib/notepad/store'
import { hasStoredData } from '@/lib/notepad/idb-storage'
import { getLastOpenNote, setLastOpenNote } from '@/lib/notepad/last-note'
import { setActiveUserId } from '@/lib/notepad/active-user'
import { allUsers, useUsersStore, LAST_USER_KEY } from '@/lib/notepad/users'
import type { EditorFocusMode, MobileView, NotepadBackup } from '@/lib/notepad/types'
import { useToast } from '@/hooks/use-toast'
import { useChromeVisibility } from '@/hooks/use-chrome-visibility'
import { Sidebar } from '@/components/notepad/sidebar'
import { NotesPane } from '@/components/notepad/notes-pane'
import { MultiEditorPane } from '@/components/notepad/multi-editor-pane'
import { NoteTabs } from '@/components/notepad/note-tabs'
import { SideBySideDialog, type SideBySideSelection } from '@/components/notepad/side-by-side-dialog'
import { SideBySideView } from '@/components/notepad/side-by-side-view'
import { FlashcardsPane } from '@/components/notepad/flashcards/flashcards-pane'
import { QuizPane } from '@/components/notepad/quiz/quiz-pane'
import { CheatSheet } from '@/components/notepad/cheat-sheet'
import { WelcomeDialog, type WelcomeChoice } from '@/components/notepad/welcome-dialog'
import { PrintRoot } from '@/components/notepad/print-root'
import { PrintDialog } from '@/components/notepad/print-dialog'
import { MdImportDialog } from '@/components/notepad/md-import-dialog'
import { ExportNotesDialog } from '@/components/notepad/export-notes-dialog'
import { ImportZipDialog } from '@/components/notepad/import-zip-dialog'
import { UserGate } from '@/components/notepad/user-gate'
import { UserMenu } from '@/components/notepad/user-menu'
import { HomeScreen } from '@/components/notepad/home-screen'
import { SyncRunner } from '@/components/notepad/sync-runner'
import { useSyncStore, type SyncStatus } from '@/lib/notepad/sync'
import { SettingsDialog } from '@/components/notepad/settings-dialog'
import { NavRail, type AppScreen } from '@/components/notepad/nav-rail'
import { BottomNav } from '@/components/notepad/bottom-nav'
import { RevisePane } from '@/components/notepad/revise-pane'
import { CommandPalette, type PaletteActions } from '@/components/notepad/command-palette'
import { MoreSheet, type MoreSheetActions } from '@/components/notepad/more-sheet'
import { useAnimationsEnabled, usePrefsStore } from '@/lib/prefs'

const emptySubscribe = () => () => {}

/** The full notepad workspace for one user. Mounted with key={userId} so
 *  switching users rebuilds all local UI state on top of the rehydrated
 *  partition — nothing of the previous user's view can leak through. */
function NotepadWorkspace({
  userId,
  onSwitchUser,
  onUserDeleted,
}: {
  /** the user this workspace belongs to (drives per-user home-screen markers) */
  userId: string
  onSwitchUser: (userId: string) => void
  /** a profile was removed in Manage users — back to the gate if it was this one */
  onUserDeleted: (userId: string, name: string) => void
}) {
  // hydration-safe "mounted" flag (false during SSR/hydration, true after)
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  const [mobileView, setMobileView] = useState<MobileView>('tree')
  const [cheatOpen, setCheatOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [mdImportOpen, setMdImportOpen] = useState(false)
  const [exportZipOpen, setExportZipOpen] = useState(false)
  const [importZipOpen, setImportZipOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sideBySideDialogOpen, setSideBySideDialogOpen] = useState(false)
  const [sideBySide, setSideBySide] = useState<SideBySideSelection | null>(null)
  const [focusMode, setFocusMode] = useState<EditorFocusMode>('off')
  // V9.0 home screen, V10.5 screens — 'home' ("Pick up where you left off"),
  // 'workspace' (subjects | notes | editor) and 'revise' (the To-revise hub);
  // opening anything from home swaps back into the workspace view
  const [screen, setScreen] = useState<AppScreen>('home')
  // V10.5 — the Ctrl/Cmd+K "Jump to" palette and the mobile More sheet
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const selectedNote = useSelectedNote()
  // Notion-style chrome: the app header and the editor toolbar auto-hide while
  // scrolling panes down; each can be pinned (kept always visible) separately.
  // Opening a note always reveals both again.
  const {
    header: { hidden: headerHidden, pinned: headerPinned, togglePinned: toggleHeaderPinned },
    toolbar: {
      hidden: toolbarHidden,
      pinned: toolbarPinned,
      dismissed: toolbarDismissed,
      togglePinned: toggleToolbarPinned,
      toggleHidden: toggleToolbarHidden,
      show: showToolbar,
    },
    showAll: showChrome,
  } = useChromeVisibility(mainRef, focusMode !== 'off', selectedNote?.id)
  // saved data is read from IndexedDB asynchronously — keep the splash up
  // until it lands so the real notes render without a seed-data flash
  const hasHydrated = useNotepadStore((s) => s.hasHydrated)
  const tabMode = usePrefsStore((s) => s.tabMode)
  const openNoteIds = useNotepadStore((s) => s.openNoteIds)
  // V10.3 — UI animations (Settings → Optimisation): slide/fade transitions
  const animsOn = useAnimationsEnabled()

  const focusActive = focusMode !== 'off'

  const syncEnabled = useSyncStore((s) => s.enabled)
  const syncStatus = useSyncStore((s) => s.status)
  const syncLabel = !syncEnabled
    ? 'Off'
    : { syncing: 'Syncing…', synced: 'Synced', offline: 'Offline', error: 'Error', conflict: 'Conflict', idle: 'On', off: 'On' }[syncStatus]
  // header badge — with cloud save on it reflects the live sync state:
  // a spinning loader while syncing, a tick once everything is synced
  const syncBadge: {
    Icon: typeof Cloud
    label: string
    iconClass?: string
    spin?: boolean
  } = !syncEnabled
    ? { Icon: HardDrive, label: 'Saved locally' }
    : {
        off: { Icon: HardDrive, label: 'Saved locally' },
        idle: { Icon: Cloud, label: 'Cloud on' },
        syncing: { Icon: Loader2, label: 'Syncing…', spin: true },
        synced: { Icon: CheckCircle2, label: 'Synced', iconClass: 'text-emerald-600 dark:text-emerald-400' },
        offline: { Icon: CloudOff, label: 'Offline', iconClass: 'text-amber-600 dark:text-amber-400' },
        error: { Icon: CloudAlert, label: 'Sync error', iconClass: 'text-destructive' },
        conflict: { Icon: TriangleAlert, label: 'Conflict', iconClass: 'text-amber-600 dark:text-amber-400' },
      }[syncStatus]
  const SyncBadgeIcon = syncBadge.Icon
  // the palette's keyboard hint matches the platform (⌘K on Apple keyboards)
  const kbdHint =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
      ? '⌘K'
      : 'Ctrl K'

  // Ctrl/Cmd+P opens the customisable print dialog instead of the raw browser print
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        if (useNotepadStore.getState().selectedNoteId) {
          e.preventDefault()
          setPrintOpen(true)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // V10.5 — Ctrl/Cmd+K toggles the "Jump to" command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---------- focus modes: full area (window only) & true fullscreen ----------

  const enterFocus = (mode: Exclude<EditorFocusMode, 'off'>) => {
    setFocusMode(mode)
    showChrome() // come back visible when the focus mode ends
    // true fullscreen also hides the browser chrome when allowed (may be
    // blocked inside sandboxed iframes — the layout focus still applies)
    if (mode === 'fullscreen') {
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
  }

  const exitFocus = () => {
    setFocusMode('off')
    showChrome()
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }

  // leaving native fullscreen (Esc / browser control) also leaves focus mode
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setFocusMode((m) => (m === 'fullscreen' ? 'off' : m))
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Esc leaves the focus mode, unless an overlay (menu/dialog/whiteboard) eats it first
  useEffect(() => {
    if (focusMode === 'off') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const overlayOpen = document.querySelector(
        '[data-state="open"][role="menu"], [data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]',
      )
      if (overlayOpen) return
      exitFocus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusMode])

  // if the open note disappears (deleted), there is nothing to focus on anymore
  useEffect(() => {
    if (focusMode !== 'off' && !selectedNote) exitFocus()
  }, [focusMode, selectedNote])

  const subjects = useNotepadStore((s) => s.subjects)
  const chapters = useNotepadStore((s) => s.chapters)
  const notes = useNotepadStore((s) => s.notes)
  const flashcards = useNotepadStore((s) => s.flashcards)
  const quizzes = useNotepadStore((s) => s.quizzes)
  const chapterTab = useNotepadStore((s) => s.chapterTab)
  const selectNote = useNotepadStore((s) => s.selectNote)
  const selectCard = useNotepadStore((s) => s.selectCard)
  const selectQuiz = useNotepadStore((s) => s.selectQuiz)
  const setChapterTab = useNotepadStore((s) => s.setChapterTab)
  const setFlashcardMode = useNotepadStore((s) => s.setFlashcardMode)
  const setQuizMode = useNotepadStore((s) => s.setQuizMode)

  // "Pick up where you left off" — remember which note is open, per user
  // (read by the home screen; a plain best-effort marker, never blocking)
  const lastOpenNoteId = selectedNote?.id ?? null
  useEffect(() => {
    if (lastOpenNoteId) setLastOpenNote(userId, lastOpenNoteId)
  }, [lastOpenNoteId, userId])

  // Settings → "Continue from last note": Yes skips the home screen and
  // reopens the last-opened note straight away. Mount-only on purpose —
  // key={userId} remounts the workspace on every user switch, so each entry
  // evaluates once (toggling the setting mid-session only applies next entry)
  useEffect(() => {
    if (!usePrefsStore.getState().continueFromLastNote) return
    const savedId = getLastOpenNote(userId)
    if (!savedId) return
    const saved = useNotepadStore.getState().notes.find((n) => n.id === savedId)
    if (!saved) return
    selectNote(saved.id)
    setChapterTab('notes')
    setScreen('workspace')
    // selectNote / setChapterTab are stable zustand actions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // the two notes of the side-by-side view (null once either is deleted)
  const sideLeft = sideBySide ? notes.find((n) => n.id === sideBySide.leftId) ?? null : null
  const sideRight = sideBySide ? notes.find((n) => n.id === sideBySide.rightId) ?? null : null
  // V10.6 — the primary nav (desktop rail / phone pill) floats over the
  // Subjects pane, which is its own area. Only true while that pane is on
  // screen: workspace, not side-by-side, no focus mode. On phones the pane
  // is only visible on the 'tree' view.
  const subjectsPaneShown = screen === 'workspace' && !(sideLeft && sideRight)
  const navRailCollapsed = usePrefsStore((s) => s.navRailCollapsed)
  const floatNavMobile = subjectsPaneShown && mobileView === 'tree' && !focusActive
  useEffect(() => {
    if (sideBySide && (!sideLeft || !sideRight)) setSideBySide(null)
  }, [sideBySide, sideLeft, sideRight])
  const exitSideBySide = () => setSideBySide(null)
  const { importData, clearAll } = useNotepadStore()
  const { toast } = useToast()

  const handleExport = () => {
    const state = useNotepadStore.getState()
    const backup: NotepadBackup = {
      subjects: state.subjects,
      chapters: state.chapters,
      notes: state.notes,
      flashcards: state.flashcards,
      quizzes: state.quizzes,
      exportedAt: new Date().toISOString(),
      version: 1,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `studypad-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast({
      title: 'Backup downloaded',
      description: `${state.notes.length} notes, ${state.flashcards.length} flashcards and ${state.quizzes.length} quizzes exported as JSON.`,
    })
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      if (!Array.isArray(data.subjects) || !Array.isArray(data.chapters) || !Array.isArray(data.notes)) {
        throw new Error('invalid')
      }
      importData({
        subjects: data.subjects,
        chapters: data.chapters,
        notes: data.notes,
        // backups from V2 and older have no flashcards — the deck starts empty
        ...(Array.isArray(data.flashcards) ? { flashcards: data.flashcards } : {}),
        // backups from V3 and older have no quizzes
        ...(Array.isArray(data.quizzes) ? { quizzes: data.quizzes } : {}),
        exportedAt: data.exportedAt ?? new Date().toISOString(),
        version: 1,
      })
      toast({
        title: 'Backup restored',
        description: `${data.notes.length} notes, ${
          Array.isArray(data.flashcards) ? data.flashcards.length : 0
        } flashcards and ${Array.isArray(data.quizzes) ? data.quizzes.length : 0} quizzes imported successfully.`,
      })
    } catch {
      toast({
        title: 'Import failed',
        description: 'That file is not a valid StudyPad backup.',
        variant: 'destructive',
      })
    }
  }

  // ---------- screens (V10.5): home ↔ workspace ↔ to-revise ----------
  const leaveHome = () => {
    setSideBySide(null)
    setScreen('workspace')
    setMobileView('editor')
  }
  const openNoteFromHome = (noteId: string) => {
    selectNote(noteId)
    setChapterTab('notes')
    leaveHome()
  }
  const openCardFromHome = (cardId: string) => {
    selectCard(cardId)
    setChapterTab('flashcards')
    setFlashcardMode('view') // land in study mode, not the card builder
    leaveHome()
  }
  const openQuizFromHome = (quizId: string) => {
    selectQuiz(quizId)
    setChapterTab('quiz')
    setQuizMode('attempt') // land in attempt mode, not the question editor
    leaveHome()
  }
  // mobile: from the home screen the subjects tree is one tap away —
  // (desktop keeps the sidebar always visible, the home button is lg-hidden)
  const openSidebarFromHome = () => {
    setSideBySide(null)
    setScreen('workspace')
    setMobileView('tree')
  }
  // V10 "View notes" — leave the home screen without opening anything;
  // mobile lands on the notes list, desktop shows the workspace as-is
  const openWorkspaceFromHome = () => {
    setSideBySide(null)
    setScreen('workspace')
    setMobileView('notes')
  }
  // V10.5 — the rail / grid icon: enter the workspace on a chosen pane
  const goToWorkspace = (view: 'tree' | 'notes' | 'editor') => {
    setSideBySide(null)
    setScreen('workspace')
    setMobileView(view)
  }
  // V10.5 — the "+" button and palette action: create a note in the selected
  // chapter (or the first one) and open it straight in the editor
  const createNewNote = () => {
    const state = useNotepadStore.getState()
    const chapterId = state.selectedChapterId ?? state.chapters[0]?.id ?? null
    if (!chapterId) {
      toast({
        title: 'No chapter to write in',
        description: 'Add a subject and a chapter in the sidebar first — then + starts the note.',
      })
      return
    }
    const note = state.addNote(chapterId)
    state.selectNote(note.id)
    setChapterTab('notes')
    goToWorkspace('editor')
  }
  // V10.5 — shared navigation set for the command palette and the mobile sheet
  const paletteActions: PaletteActions = {
    goHome: () => setScreen('home'),
    goRevise: () => setScreen('revise'),
    goWorkspace: goToWorkspace,
    newNote: createNewNote,
    openSettings: () => setSettingsOpen(true),
    openCheatSheet: () => setCheatOpen(true),
    openSync: () => useSyncStore.getState().setDialogOpen(true),
    exportBackup: handleExport,
    exportZip: () => setExportZipOpen(true),
    importBackup: () => fileInputRef.current?.click(),
    importMd: () => setMdImportOpen(true),
    importZip: () => setImportZipOpen(true),
  }
  const moreActions: MoreSheetActions = {
    ...paletteActions,
    clearAll: () => setClearOpen(true),
    toggleHeaderPinned,
  }

  // welcome dialog: keep the current (seeded) notes or start from an empty pad
  const handleWelcomeChoice = (choice: WelcomeChoice, returning: boolean) => {
    if (choice === 'fresh') {
      clearAll()
      setMobileView('tree')
      toast({
        title: 'Starting afresh',
        description: 'Your notepad is empty — add your first subject to begin.',
      })
    } else {
      const count = useNotepadStore.getState().notes.length
      toast({
        title: returning ? 'Your notes stay as they are' : 'Test data kept',
        description:
          count > 0
            ? `${count} ${returning ? 'notes kept.' : 'sample notes are ready to explore.'}`
            : 'Have fun exploring the editor.',
      })
    }
  }

  if (!mounted || !hasHydrated) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-background">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
          <GraduationCap className="h-7 w-7" />
        </div>
        <p className="text-sm text-muted-foreground">Loading your notes…</p>
      </div>
    )
  }

  return (
    <>
      <div
        className={cn(
          'flex h-dvh flex-col bg-background text-foreground lg:pb-0',
          // the phone pill floats over the Subjects pane (which pads its own
          // scroll area) — every other mobile view keeps the reserved strip
          !floatNavMobile && 'pb-[4.5rem]',
        )}
      >
      {/* Header — slides away while scrolling panes down (unless pinned);
          fully hidden while a focus mode is active */}
      {!focusActive && (
        <header
          inert={headerHidden}
          className={cn(
            'shrink-0 overflow-hidden transition-[height] duration-200 ease-out',
            headerHidden ? 'h-0' : 'h-16 lg:h-14',
          )}
        >
        {/* V10.5 — the sketch header: a floating full-round pill on mobile
            (logo, cloud sync beside the title, notes, avatar) and the classic
            bar from lg up (search + "Jump to" palette triggers, +, grid,
            data, avatar). Home / To revise live in the rail / bottom nav. */}
        <div className="flex h-full items-center px-3 pb-2 pt-2 lg:border-b lg:px-4 lg:pb-0 lg:pt-0">
        <div className="flex h-12 w-full items-center gap-1.5 rounded-full border bg-card px-2 shadow-sm lg:h-full lg:w-auto lg:flex-1 lg:gap-3 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0 lg:shadow-none">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-bold">StudyPad</h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">Notepad for studies</p>
          </div>
        </div>
        {/* cloud sync right beside the title — mobile sketch: SHOW CLOUD SYNC HERE */}
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
          aria-label={`Cloud save: ${syncBadge.label} — open cloud save`}
          title={`Cloud save: ${syncBadge.label}`}
          data-testid="sync-badge-mobile"
          onClick={() => useSyncStore.getState().setDialogOpen(true)}
        >
          <SyncBadgeIcon
            className={cn(
              'h-4 w-4 shrink-0',
              syncBadge.iconClass,
              syncBadge.spin && 'animate-spin keep-anim',
            )}
            aria-hidden
          />
        </button>
        <Badge variant="secondary" className="hidden gap-1 sm:inline-flex" data-testid="sync-badge">
          <SyncBadgeIcon
            className={cn(
              'h-3 w-3 shrink-0',
              syncBadge.iconClass,
              syncBadge.spin && 'animate-spin keep-anim',
            )}
            aria-hidden
          />
          {syncBadge.label}
        </Badge>

        {/* desktop: both search and the sketch's "Jump to, ctrl+k or cmd+k"
            box open the same command palette */}
        <button
          type="button"
          className="hidden h-9 w-44 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent/60 xl:w-56 lg:flex"
          onClick={() => setPaletteOpen(true)}
          aria-label="Search — opens the jump-to palette"
          data-testid="header-search"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          Search…
        </button>
        <button
          type="button"
          className="hidden h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent/60 lg:flex"
          onClick={() => setPaletteOpen(true)}
          aria-label="Jump to — opens the command palette"
          data-testid="header-jump"
        >
          Jump to
          <kbd
            className="ml-2 rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground"
            data-testid="jump-kbd"
          >
            {kbdHint}
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          {/* V10.5 — "+": one tap creates a note in the open chapter */}
          <Button
            variant="outline"
            size="icon"
            className="hidden h-8 w-8 lg:inline-flex"
            aria-label="New note"
            title="New note"
            data-testid="header-new-note"
            onClick={createNewNote}
          >
            <Plus className="h-4 w-4" />
          </Button>
          {/* the sketch's grid icon — one tap into the notes workspace */}
          <Button
            variant={screen === 'workspace' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-8 w-8"
            aria-label="Open the notes workspace"
            title="Notes"
            data-testid="header-notes-button"
            onClick={() => goToWorkspace('notes')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          {/* data menu (desktop — the mobile More sheet carries all of these) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="hidden h-8 w-8 lg:inline-flex"
                aria-label="Data menu"
              >
                <Database className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <SlidersHorizontal className="h-4 w-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCheatOpen(true)}>
                <BookOpen className="h-4 w-4" /> Cheat sheet
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleHeaderPinned} data-testid="menu-pin-header">
                {headerPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
                {headerPinned ? 'Unpin header' : 'Keep header visible'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">Backup & data</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleExport}>
                <Download className="h-4 w-4" /> Export backup (.json)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setExportZipOpen(true)}>
                <FileArchive className="h-4 w-4" /> Export notes (.zip)…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Import backup
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setMdImportOpen(true)}>
                <FileUp className="h-4 w-4" /> Import note (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportZipOpen(true)}>
                <ArchiveRestore className="h-4 w-4" /> Import notes (.zip)…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => useSyncStore.getState().setDialogOpen(true)} data-testid="sync-menu-item">
                <Cloud className="h-4 w-4" /> Cloud save…
                <span className="ml-auto text-[10px] text-muted-foreground">{syncLabel}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setClearOpen(true)}>
                <Trash2 className="h-4 w-4" /> Clear all data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* multi-user: switch users or manage profiles — sits beside the data menu */}
          <UserMenu
            onSwitchUser={onSwitchUser}
            onUserAdded={(name) =>
              toast({
                title: 'User added',
                description: `${name} was created — switch from the user menu anytime.`,
              })
            }
            onUserRenamed={(name) =>
              toast({
                title: 'User renamed',
                description: `This profile is now called ${name}. Their notes stayed with them.`,
              })
            }
            onUserDeleted={onUserDeleted}
          />
        </div>
        </div>
        </div>
      </header>
      )}

      {/* Note tabs — swappable open notes (Settings → Note tabs → Multiple);
          hidden with the rest of the chrome in focus mode */}
      {/* home screen keeps the chrome minimal — the open-tabs bar stays hidden */}
      {!focusActive && screen === 'workspace' && tabMode === 'multi' && openNoteIds.length > 0 && (
        <NoteTabs
          onOpenNote={() => {
            setSideBySide(null)
            setScreen('workspace')
            setMobileView('editor')
          }}
          onSideBySide={() => setSideBySideDialogOpen(true)}
        />
      )}

      {/* Panes — side-by-side replaces everything with two full-width panes;
          in focus mode only the editor remains. The keyed wrapper replays a
          fade/rise entrance on every view swap (home ↔ workspace ↔ side-by-side)
          — the branches already remount, this only adds the transition. */}
      {/* V10.5 — the collapsible notes pane (nav rail) sits left of everything */}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <NavRail
          screen={screen}
          hidden={focusActive}
          floating={subjectsPaneShown}
          onHome={() => setScreen('home')}
          onNotes={() => goToWorkspace('notes')}
          onRevise={() => setScreen('revise')}
        />
        <main ref={mainRef} className="flex min-h-0 min-w-0 flex-1">
        <div
          key={screen === 'workspace' && sideLeft && sideRight ? 'side-by-side' : screen}
          className={cn('flex min-h-0 min-w-0 flex-1', animsOn && 'anim-view-enter')}
        >
        {screen === 'home' ? (
          <HomeScreen
            userId={userId}
            onOpenNote={openNoteFromHome}
            onOpenCard={openCardFromHome}
            onOpenQuiz={openQuizFromHome}
            onOpenSidebar={openSidebarFromHome}
            onOpenWorkspace={openWorkspaceFromHome}
          />
        ) : screen === 'revise' ? (
          <RevisePane onOpenNote={openNoteFromHome} />
        ) : sideLeft && sideRight ? (
          <SideBySideView
            left={sideLeft}
            right={sideRight}
            chapters={chapters}
            onExit={exitSideBySide}
          />
        ) : (
          <>
        <aside
          className={cn(
            'w-full shrink-0 overflow-y-auto border-r bg-muted/20 max-lg:pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]',
            // desktop: the floating rail sits over this pane, so the pane
            // keeps a strip on its left (rail width, or the slim show-handle)
            navRailCollapsed ? 'lg:w-[17.75rem] lg:pl-7' : 'lg:w-[21rem] lg:pl-20',
            focusActive
              ? 'hidden'
              : cn(
                  'lg:block',
                  mobileView === 'tree'
                    ? animsOn
                      ? 'block anim-view-enter'
                      : 'block'
                    : 'hidden',
                ),
          )}
          aria-label="Subjects"
        >
          <Sidebar onOpenChapter={() => setMobileView('notes')} />
        </aside>

        <section
          className={cn(
            'w-full shrink-0 lg:w-80',
            focusActive
              ? 'hidden'
              : cn(
                  'lg:block',
                  mobileView === 'notes'
                    ? animsOn
                      ? 'block anim-view-enter'
                      : 'block'
                    : 'hidden',
                ),
          )}
          aria-label="Notes list"
        >
          <NotesPane
            onBack={() => setMobileView('tree')}
            onOpenNote={() => setMobileView('editor')}
            onImportMd={() => setMdImportOpen(true)}
          />
        </section>

        <section
          className={cn(
            'min-w-0 flex-1',
            focusActive
              ? 'block'
              : cn('lg:block', mobileView === 'editor' ? 'block' : 'hidden'),
          )}
          aria-label={
            chapterTab === 'flashcards'
              ? 'Flashcards workspace'
              : chapterTab === 'quiz'
                ? 'Quiz workspace'
                : 'Note editor'
          }
        >
          {/* Notes / Flashcards / Quiz tab panels — the keyed wrapper replays
              the fade/rise entrance whenever the tab strip switches */}
          <div
            key={chapterTab}
            className={cn('h-full min-h-0', animsOn && 'anim-view-enter')}
          >
          {chapterTab === 'flashcards' ? (
            <FlashcardsPane
              onBack={() => setMobileView('notes')}
              onOpenSidebar={() => setMobileView('tree')}
              focusMode={focusMode}
              onEnterFocus={enterFocus}
              onExitFocus={exitFocus}
            />
          ) : chapterTab === 'quiz' ? (
            <QuizPane
              onBack={() => setMobileView('notes')}
              onOpenSidebar={() => setMobileView('tree')}
              focusMode={focusMode}
              onEnterFocus={enterFocus}
              onExitFocus={exitFocus}
            />
          ) : (
            <MultiEditorPane
              onBack={() => setMobileView('notes')}
              onOpenSidebar={() => setMobileView('tree')}
              onOpenCheatSheet={() => setCheatOpen(true)}
              onPrint={() => setPrintOpen(true)}
              focusMode={focusMode}
              onEnterFocus={enterFocus}
              onExitFocus={exitFocus}
              toolbarHidden={toolbarHidden}
              toolbarPinned={toolbarPinned}
              toolbarDismissed={toolbarDismissed}
              onToggleToolbarPinned={toggleToolbarPinned}
              onToggleToolbarHidden={toggleToolbarHidden}
              onRevealToolbar={showToolbar}
            />
          )}
          </div>
        </section>
          </>
        )}
        </div>
        </main>
      </div>

      {/* Footer — mobile navigates from the bottom pill instead; hidden in focus mode */}
      {!focusActive && (
      <footer className="mt-auto hidden shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-t px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[11px] text-muted-foreground lg:flex">
        <span className="tabular-nums">
          {subjects.length} subjects · {chapters.length} chapters · {notes.length} notes ·{' '}
          {flashcards.length} flashcards · {quizzes.length} quizzes — stored in your browser
        </span>
        <span className="hidden md:inline">
          {'$…$'} math · {'\\ce{}'} chemistry · ==labels== · type / to insert · Ctrl+P print
        </span>
      </footer>
      )}

      <CheatSheet open={cheatOpen} onOpenChange={setCheatOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={paletteActions} />
      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        actions={moreActions}
        headerPinned={headerPinned}
        syncLabel={syncLabel}
      />
      <BottomNav
        screen={screen}
        hidden={focusActive}
        onHome={() => setScreen('home')}
        onNotes={() => goToWorkspace('notes')}
        onSearch={() => setPaletteOpen(true)}
        onMore={() => setMoreOpen(true)}
      />
      <WelcomeDialog onChoose={handleWelcomeChoice} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <SideBySideDialog
        open={sideBySideDialogOpen}
        onOpenChange={setSideBySideDialogOpen}
        onConfirm={(sel) => {
          setSideBySide(sel)
          setSideBySideDialogOpen(false)
        }}
      />
      <MdImportDialog
        open={mdImportOpen}
        onOpenChange={setMdImportOpen}
        onImported={() => setMobileView('editor')}
      />
      <ExportNotesDialog open={exportZipOpen} onOpenChange={setExportZipOpen} />
      <ImportZipDialog
        open={importZipOpen}
        onOpenChange={setImportZipOpen}
        onImported={() => setMobileView('editor')}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFile}
        aria-label="Import backup file"
      />

      {/* Clear all confirmation */}
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all data?</AlertDialogTitle>
            <AlertDialogDescription>
              Every subject, chapter and note will be deleted from this browser. Consider
              exporting a backup first — this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                clearAll()
                setClearOpen(false)
                setMobileView('tree')
                toast({ title: 'All data cleared', description: 'Your notepad is empty now.' })
              }}
            >
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>

      {/* Print pipeline — #print-root is a direct child of <body> so that
          @media print can hide everything else while printing */}
      <PrintRoot />
      <PrintDialog open={printOpen} onOpenChange={setPrintOpen} />
    </>
  )
}

/**
 * Page entry — every load starts at the user-selection gate ("who is
 * studying today?"). Nothing of the notepad mounts until a user is picked,
 * so the store only ever hydrates into that user's own data partition.
 * With no users added yet the gate shows the built-in Guest pad.
 */
export default function Home() {
  const [userId, setUserId] = useState<string | null>(null)
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  // "last used" marker on the gate — read after mount to stay SSR-safe
  const [lastUserId, setLastUserId] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    try {
      setLastUserId(window.localStorage.getItem(LAST_USER_KEY))
    } catch {
      // cosmetic only
    }
  }, [])

  const enterUser = useCallback(
    async (id: string) => {
      setSwitchingTo(id)
      // point the storage layer at the chosen partition before hydrating
      setActiveUserId(id)
      useUsersStore.getState().setCurrentUserId(id)
      try {
        window.localStorage.setItem(LAST_USER_KEY, id)
      } catch {
        // cosmetic only
      }
      await useNotepadStore.persist.rehydrate()
      // rehydrate leaves the previous user's state in place when the target
      // partition has never been written — reset to the seeded pad instead,
      // so a new user neither sees nor saves another user's notes
      if (!hasStoredData()) resetPadToSeeds()
      const wasSwitching = userId !== null
      setUserId(id)
      setSwitchingTo(null)
      if (wasSwitching) {
        const name =
          allUsers(useUsersStore.getState().users).find((u) => u.id === id)?.name ?? 'user'
        toast({
          title: `Switched to ${name}`,
          description: 'Each user keeps their own notepad on this device.',
        })
      }
    },
    [userId, toast],
  )

  // removing the profile that is currently open signs out to the gate;
  // removing any other profile just tidies the registry
  // (declared before the early return — hooks must run in a fixed order)
  const handleUserDeleted = useCallback(
    (id: string, name: string) => {
      if (id === userId) {
        setUserId(null)
        toast({
          title: `${name} removed`,
          description: 'Their notepad was deleted from this device. Pick a user to continue.',
        })
      } else {
        toast({
          title: `${name} removed`,
          description: 'Their notepad was deleted from this device.',
        })
      }
    },
    [userId, toast],
  )

  return (
    <>
      <SyncRunner userId={userId} />
      {userId ? (
        <NotepadWorkspace
          key={userId}
          userId={userId}
          onSwitchUser={enterUser}
          onUserDeleted={handleUserDeleted}
        />
      ) : (
        <UserGate onEnter={enterUser} busy={switchingTo} lastUserId={lastUserId} />
      )}
    </>
  )
}
