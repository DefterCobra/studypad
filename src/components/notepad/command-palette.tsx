'use client'

/**
 * V10.5 — the "Jump to" command palette (sketch header box, Ctrl/Cmd+K).
 *
 * One dialog that reaches everything: app actions (home, notes, To revise,
 * new note, settings, cheat sheet, cloud save, backups), every chapter by
 * subject, every note, flashcard and quiz on the pad. Choosing anything
 * navigates with the same semantics as the home screen picks — notes land
 * in the editor, cards in deck-study, quizzes in attempt mode — so it works
 * as both a launcher and a universal search. Rendered from the live store,
 * so it is always current with what the user actually has.
 */
import { useMemo } from 'react'
import {
  BookOpen,
  ChevronsRight,
  Cloud,
  Download,
  FileArchive,
  FileUp,
  FileText,
  House,
  Layers,
  ListChecks,
  NotebookPen,
  Plus,
  Settings,
  Upload,
} from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useNotepadStore } from '@/lib/notepad/store'

export interface PaletteActions {
  goHome: () => void
  goRevise: () => void
  /** enter the workspace, landing on the given mobile pane */
  goWorkspace: (view: 'tree' | 'notes' | 'editor') => void
  newNote: () => void
  openSettings: () => void
  openCheatSheet: () => void
  openSync: () => void
  exportBackup: () => void
  exportZip: () => void
  importBackup: () => void
  importMd: () => void
  importZip: () => void
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: PaletteActions
}

export function CommandPalette({ open, onOpenChange, actions }: CommandPaletteProps) {
  const notes = useNotepadStore((s) => s.notes)
  const chapters = useNotepadStore((s) => s.chapters)
  const subjects = useNotepadStore((s) => s.subjects)
  const flashcards = useNotepadStore((s) => s.flashcards)
  const quizzes = useNotepadStore((s) => s.quizzes)

  const selectChapter = useNotepadStore((s) => s.selectChapter)
  const selectNote = useNotepadStore((s) => s.selectNote)
  const selectCard = useNotepadStore((s) => s.selectCard)
  const selectQuiz = useNotepadStore((s) => s.selectQuiz)
  const setChapterTab = useNotepadStore((s) => s.setChapterTab)
  const setFlashcardMode = useNotepadStore((s) => s.setFlashcardMode)
  const setQuizMode = useNotepadStore((s) => s.setQuizMode)

  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }

  const recentNotes = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt),
    [notes],
  )

  const chapterById = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters])
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])

  const openChapter = (chapterId: string) =>
    run(() => {
      selectChapter(chapterId)
      actions.goWorkspace('notes')
    })
  const openNote = (noteId: string) =>
    run(() => {
      selectNote(noteId)
      setChapterTab('notes')
      actions.goWorkspace('editor')
    })
  const openCard = (cardId: string) =>
    run(() => {
      selectCard(cardId)
      setChapterTab('flashcards')
      setFlashcardMode('view')
      actions.goWorkspace('editor')
    })
  const openQuiz = (quizId: string) =>
    run(() => {
      selectQuiz(quizId)
      setChapterTab('quiz')
      setQuizMode('attempt')
      actions.goWorkspace('editor')
    })

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to"
      description="Search notes, cards, quizzes and chapters — or run an action"
      data-testid="command-palette"
      className="sm:max-w-xl"
    >
      <CommandInput
        placeholder="Jump to a note, chapter, card, quiz or action…"
        data-testid="palette-input"
      />
      <CommandList className="max-h-[60dvh]">
        <CommandEmpty>No matches — try another word.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(actions.goHome)} data-testid="palette-action-home">
            <House /> Go to the home screen
          </CommandItem>
          <CommandItem onSelect={() => run(() => actions.goWorkspace('notes'))}>
            <NotebookPen /> Open the notes workspace
          </CommandItem>
          <CommandItem onSelect={() => run(actions.goRevise)} data-testid="palette-action-revise">
            <ChevronsRight /> To revise
          </CommandItem>
          <CommandItem onSelect={() => run(actions.newNote)} data-testid="palette-action-new-note">
            <Plus /> New note
          </CommandItem>
          <CommandItem onSelect={() => run(actions.openSettings)}>
            <Settings /> Settings
          </CommandItem>
          <CommandItem onSelect={() => run(actions.openCheatSheet)}>
            <BookOpen /> Formula &amp; markdown cheat sheet
          </CommandItem>
          <CommandItem onSelect={() => run(actions.openSync)}>
            <Cloud /> Cloud save…
          </CommandItem>
          <CommandItem onSelect={() => run(actions.exportBackup)}>
            <Download /> Export backup (.json)
          </CommandItem>
          <CommandItem onSelect={() => run(actions.exportZip)}>
            <FileArchive /> Export notes (.zip)…
          </CommandItem>
          <CommandItem onSelect={() => run(actions.importBackup)}>
            <Upload /> Import backup
          </CommandItem>
          <CommandItem onSelect={() => run(actions.importMd)}>
            <FileUp /> Import note (.md)
          </CommandItem>
          <CommandItem onSelect={() => run(actions.importZip)}>
            <FileArchive /> Import notes (.zip)…
          </CommandItem>
        </CommandGroup>

        {chapters.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Chapters">
              {chapters.map((chapter) => {
                const subject = subjectById.get(chapter.subjectId)
                return (
                  <CommandItem
                    key={chapter.id}
                    value={`chapter ${chapter.name} ${subject?.name ?? ''}`}
                    onSelect={() => openChapter(chapter.id)}
                    data-testid={`palette-chapter-${chapter.id}`}
                  >
                    {subject?.color && (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: subject.color }}
                        aria-hidden
                      />
                    )}
                    <span className="truncate">{chapter.name}</span>
                    {subject && (
                      <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                        {subject.name}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        )}

        {recentNotes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Notes">
              {recentNotes.map((note) => {
                const chapter = chapterById.get(note.chapterId)
                return (
                  <CommandItem
                    key={note.id}
                    value={`note ${note.title} ${note.content.slice(0, 120)} ${chapter?.name ?? ''}`}
                    onSelect={() => openNote(note.id)}
                    data-testid={`palette-note-${note.id}`}
                  >
                    <FileText />
                    <span className="truncate">{note.title || 'Untitled note'}</span>
                    {chapter && (
                      <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                        {chapter.name}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        )}

        {flashcards.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Flashcards">
              {flashcards.map((card) => (
                <CommandItem
                  key={card.id}
                  value={`flashcard ${card.front} ${card.back}`}
                  onSelect={() => openCard(card.id)}
                  data-testid={`palette-card-${card.id}`}
                >
                  <Layers />
                  <span className="truncate">{card.front || 'Empty card'}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {quizzes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Quizzes">
              {quizzes.map((quiz) => (
                <CommandItem
                  key={quiz.id}
                  value={`quiz ${quiz.title}`}
                  onSelect={() => openQuiz(quiz.id)}
                  data-testid={`palette-quiz-${quiz.id}`}
                >
                  <ListChecks />
                  <span className="truncate">{quiz.title}</span>
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                    {quiz.questions.length} Q
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
