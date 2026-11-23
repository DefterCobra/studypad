'use client'

/**
 * V10.5 — mobile "More" bottom sheet, the fourth bottom-nav item (sketch's
 * ">>"). Everything the desktop header carries but a phone should not:
 * the To-revise hub, settings, cheat sheet, cloud save and every backup /
 * import / clear action, in one slide-up list. Each entry closes the sheet
 * first so dialogs and confirmations never fight Radix for the focus trap.
 */
import {
  ArchiveRestore,
  BookOpen,
  ChevronsRight,
  Cloud,
  Download,
  FileArchive,
  FileUp,
  Pin,
  PinOff,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

export interface MoreSheetActions {
  goRevise: () => void
  openSettings: () => void
  openCheatSheet: () => void
  openSync: () => void
  exportBackup: () => void
  exportZip: () => void
  importBackup: () => void
  importMd: () => void
  importZip: () => void
  clearAll: () => void
  toggleHeaderPinned: () => void
}

interface MoreSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: MoreSheetActions
  /** live header pin state (the sheet re-renders on every open) */
  headerPinned: boolean
  /** short cloud-save status word for the sync row */
  syncLabel: string
}

export function MoreSheet({ open, onOpenChange, actions, headerPinned, syncLabel }: MoreSheetProps) {
  const run = (fn: () => void) => {
    onOpenChange(false)
    // let the sheet finish closing before any dialog/alert opens — Radix
    // dislikes two focus traps racing each other
    window.setTimeout(fn, 180)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-testid="more-sheet"
        className="rounded-t-3xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>More options</SheetTitle>
          <SheetDescription>Revision, settings, cloud save and backups</SheetDescription>
        </SheetHeader>
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-muted" aria-hidden />
        <div className="flex max-h-[65dvh] flex-col gap-0.5 overflow-y-auto">
          <MoreRow
            icon={<ChevronsRight className="h-4 w-4" />}
            label="To revise"
            testid="more-revise"
            onClick={() => run(actions.goRevise)}
          />
          <MoreRow
            icon={<SlidersHorizontal className="h-4 w-4" />}
            label="Settings"
            testid="more-settings"
            onClick={() => run(actions.openSettings)}
          />
          <MoreRow
            icon={<BookOpen className="h-4 w-4" />}
            label="Cheat sheet"
            onClick={() => run(actions.openCheatSheet)}
          />
          <MoreRow
            icon={<Cloud className="h-4 w-4" />}
            label="Cloud save…"
            trailing={syncLabel}
            testid="more-sync"
            onClick={() => run(actions.openSync)}
          />
          <div className="mx-2 my-2 h-px bg-border" aria-hidden />
          <MoreRow
            icon={<Download className="h-4 w-4" />}
            label="Export backup (.json)"
            onClick={() => run(actions.exportBackup)}
          />
          <MoreRow
            icon={<FileArchive className="h-4 w-4" />}
            label="Export notes (.zip)…"
            onClick={() => run(actions.exportZip)}
          />
          <MoreRow
            icon={<Upload className="h-4 w-4" />}
            label="Import backup"
            onClick={() => run(actions.importBackup)}
          />
          <MoreRow
            icon={<FileUp className="h-4 w-4" />}
            label="Import note (.md)"
            onClick={() => run(actions.importMd)}
          />
          <MoreRow
            icon={<ArchiveRestore className="h-4 w-4" />}
            label="Import notes (.zip)…"
            onClick={() => run(actions.importZip)}
          />
          <MoreRow
            icon={headerPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
            label={headerPinned ? 'Header pinned — unpin' : 'Keep header visible while scrolling'}
            onClick={() => run(actions.toggleHeaderPinned)}
          />
          <div className="mx-2 my-2 h-px bg-border" aria-hidden />
          <MoreRow
            icon={<Trash2 className="h-4 w-4" />}
            label="Clear all data"
            destructive
            testid="more-clear"
            onClick={() => run(actions.clearAll)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MoreRow({
  icon,
  label,
  trailing,
  onClick,
  destructive,
  testid,
}: {
  icon: React.ReactNode
  label: string
  trailing?: string
  onClick: () => void
  destructive?: boolean
  testid?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={
        'flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-sm transition-colors ' +
        (destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-accent')
      }
    >
      {icon}
      <span className="truncate">{label}</span>
      {trailing && (
        <span className="ml-auto text-[11px] text-muted-foreground">{trailing}</span>
      )}
    </button>
  )
}
