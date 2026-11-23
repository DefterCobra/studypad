'use client'

/**
 * V10.5 — "To revise" hub (nav-rail / bottom-nav destination).
 *
 * A focused revision list: every note the student flagged with
 * "Mark to revise" (notes list → ⋯ menu) lands here with its chapter and
 * subject context, one tap from a re-read. Unflagging is inline, so the
 * list doubles as a checklist to work down before an exam. Notes missing
 * from the pad (deleted elsewhere) are ignored automatically — the list
 * is derived, nothing is stored except the flag on each note itself.
 */
import { useMemo } from 'react'
import { ArrowRight, Flag, FlagOff, NotebookPen, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useNotepadStore } from '@/lib/notepad/store'
import { makeExcerpt } from '@/lib/notepad/constants'

interface RevisePaneProps {
  /** open the note back in the editor (caller handles the view swap) */
  onOpenNote: (noteId: string) => void
}

/** compact "when" line, kept local to avoid importing the home screen */
function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(ts).toLocaleDateString()
}

export function RevisePane({ onOpenNote }: RevisePaneProps) {
  const notes = useNotepadStore((s) => s.notes)
  const chapters = useNotepadStore((s) => s.chapters)
  const subjects = useNotepadStore((s) => s.subjects)
  const toggleRevise = useNotepadStore((s) => s.toggleRevise)

  const flagged = useMemo(
    () =>
      notes
        .filter((n) => n.revise)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [notes],
  )

  const chapterById = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters])
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])

  return (
    <div
      className="min-w-0 flex-1 overflow-y-auto"
      data-testid="revise-pane"
      aria-label="To revise"
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-600 dark:text-rose-400">
          <RotateCcw className="h-4 w-4" aria-hidden />
          Revision list
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-extrabold uppercase tracking-tight sm:text-3xl">
            To revise
          </h1>
          <Badge
            variant="secondary"
            className="px-2 text-xs tabular-nums"
            data-testid="revise-count"
          >
            {flagged.length}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Notes you flagged for another read — flag them from any note&apos;s ⋯ menu in the notes
          list.
        </p>

        {flagged.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center">
            <Flag className="h-9 w-9 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium">Nothing to revise yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Open a chapter&apos;s notes list, tap the ⋯ button on a note and choose
              &ldquo;Mark to revise&rdquo; — it will wait for you here.
            </p>
          </div>
        ) : (
          <ul className="mt-5 space-y-2">
            {flagged.map((note) => {
              const chapter = chapterById.get(note.chapterId)
              const subject = chapter ? subjectById.get(chapter.subjectId) : undefined
              return (
                <li key={note.id} className="group/revise relative">
                  <button
                    type="button"
                    data-testid={`revise-open-${note.id}`}
                    aria-label={`Open ${note.title || 'Untitled note'}`}
                    onClick={() => onOpenNote(note.id)}
                    className="flex w-full items-start gap-3 rounded-xl border bg-card p-3.5 pr-11 text-left transition-colors hover:border-rose-500/60 hover:bg-muted/40"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                      <NotebookPen className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {note.title || 'Untitled note'}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {makeExcerpt(note.content, 90) || 'Empty note'}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {subject?.color && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: subject.color }}
                            aria-hidden
                          />
                        )}
                        <span className="truncate">
                          {[chapter?.name, timeAgo(note.updatedAt)].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </span>
                    <ArrowRight
                      className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/60"
                      aria-hidden
                    />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1.5 top-1.5 h-8 w-8 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                    aria-label={`Remove ${note.title || 'Untitled note'} from To revise`}
                    title="Remove from To revise"
                    data-testid={`revise-unflag-${note.id}`}
                    onClick={() => toggleRevise(note.id)}
                  >
                    <FlagOff className="h-4 w-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
