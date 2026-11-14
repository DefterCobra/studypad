'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  BookOpen,
  BookOpenText,
  Brush,
  Check,
  ChevronDown,
  ChevronLeft,
  Clipboard,
  Code,
  Copy,
  Download,
  FileText,
  FlaskConical,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  PanelLeft,
  PanelTopClose,
  PanelTopOpen,
  Pencil,
  Pin,
  PinOff,
  Printer,
  Quote,
  RectangleHorizontal,
  Sigma,
  Sparkles,
  Table,
  Tag,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useNotepadStore } from '@/lib/notepad/store'
import type { EditorFocusMode } from '@/lib/notepad/types'
import { useToast } from '@/hooks/use-toast'
import { BlockEditor, type BlockEditorHandle } from './block-editor'
import { rememberScroll, recallScroll } from '@/lib/notepad/scroll-memory'
import { autoResize } from '@/lib/notepad/blocks'
import { FORMULA_TEMPLATES, unwrapTemplate, type ImageAction } from './snippets'
import { Latex, MarkdownPreview } from './markdown-preview'
import { Whiteboard } from './whiteboard'
import { FormulaMakerDialog } from './formula-maker/formula-maker-dialog'
import { LARGE_IMAGE_BYTES, formatBytes, processImageFile } from '@/lib/notepad/image'

export interface EditorPaneProps {
  /** pin this pane to one note (multi-tab grid) — defaults to the store's
   *  selected note, which keeps the classic single-editor behaviour */
  noteId?: string
  /** remember + replay this pane's scroll offset across unmounts
   *  ("Optimise multi tabs: Yes" — see lib/notepad/scroll-memory.ts) */
  scrollMemory?: boolean
  onBack?: () => void
  onOpenSidebar?: () => void
  onOpenCheatSheet?: () => void
  onPrint?: () => void
  /** current focus mode: 'off' | 'area' (window only) | 'fullscreen' */
  focusMode?: EditorFocusMode
  onEnterFocus?: (mode: 'area' | 'fullscreen') => void
  onExitFocus?: () => void
  /** editor toolbar auto-hide state — shared chrome behaviour with the app header */
  toolbarHidden?: boolean
  toolbarPinned?: boolean
  /** explicit "Hide toolbar" choice — overrides every automatic reveal */
  toolbarDismissed?: boolean
  onToggleToolbarPinned?: () => void
  onToggleToolbarHidden?: () => void
  /** called when anything inside the pane gains focus — brings the toolbar back */
  onRevealToolbar?: () => void
  /** bumped by the app header's Formula maker button — the editor of the
   *  currently selected note reacts by opening its formula maker dialog */
  formulaMakerRequest?: number
}

export function EditorPane({
  noteId,
  scrollMemory = false,
  onBack,
  onOpenSidebar,
  onOpenCheatSheet,
  onPrint,
  focusMode = 'off',
  onEnterFocus,
  onExitFocus,
  toolbarHidden = false,
  toolbarPinned = true,
  toolbarDismissed = false,
  onToggleToolbarPinned,
  onToggleToolbarHidden,
  onRevealToolbar,
  formulaMakerRequest,
}: EditorPaneProps) {
  const note = useNotepadStore((s) => {
    const id = noteId ?? s.selectedNoteId
    return id ? (s.notes.find((n) => n.id === id) ?? null) : null
  })
  const chapters = useNotepadStore((s) => s.chapters)
  const subjects = useNotepadStore((s) => s.subjects)
  const { updateNote, togglePin, deleteNote, addNote } = useNotepadStore()
  const { toast } = useToast()
  const editorRef = useRef<BlockEditorHandle>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [whiteboardOpen, setWhiteboardOpen] = useState(false)
  const [whiteboardInitial, setWhiteboardInitial] = useState<string | null>(null)
  const [annotateTargetId, setAnnotateTargetId] = useState<string | null>(null)
  const [formulaMakerOpen, setFormulaMakerOpen] = useState(false)
  // V10.2 — reading mode: the note renders as clean read-only prose while the
  // toolbar, title field and block editor step out of the way
  const [reading, setReading] = useState(false)
  // app header's Formula maker button — every mounted pane sees the counter,
  // but only the editor of the currently selected note reacts (hidden
  // stacked panes belong to other notes). The ref starts at the incoming
  // value so a pane remounting mid-session never replays an old request.
  const selectedNoteId = useNotepadStore((s) => s.selectedNoteId)
  const lastFormulaRequest = useRef(formulaMakerRequest ?? 0)
  useEffect(() => {
    const req = formulaMakerRequest ?? 0
    if (!formulaMakerRequest || req === lastFormulaRequest.current) return
    lastFormulaRequest.current = req
    if ((noteId ?? selectedNoteId) !== selectedNoteId) return
    // inserting needs the block editor — reading mode steps aside
    setReading(false)
    setFormulaMakerOpen(true)
  }, [formulaMakerRequest, noteId, selectedNoteId])

  // Esc leaves reading mode — same convention as the focus modes
  useEffect(() => {
    if (!reading) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReading(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading])

  // grow the title to fit — long titles wrap to more lines instead of
  // scrolling sideways and disappearing
  useLayoutEffect(() => {
    autoResize(titleRef.current)
  }, [note?.id, note?.title])

  // re-measure on viewport changes too — resizing the window re-wraps the
  // title, and the stale height would clip the extra lines
  useEffect(() => {
    const onResize = () => autoResize(titleRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ---------- scroll memory ("Optimise multi tabs: Yes") ----------
  // the editor unmounts on every tab switch, so the outgoing offset is kept
  // in a capped map by a passive listener, and the incoming note's saved
  // offset is replayed before paint (+2 rAF to survive KaTeX / auto-resize
  // settling). Fresh notes open at the top.
  const activeNoteId = note?.id ?? null
  useEffect(() => {
    if (!scrollMemory || !activeNoteId) return
    const el = bodyRef.current
    if (!el) return
    const onScroll = () => rememberScroll(activeNoteId, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollMemory, activeNoteId])

  useLayoutEffect(() => {
    if (!scrollMemory || !activeNoteId) return
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = recallScroll(activeNoteId) ?? 0
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.scrollTop = recallScroll(activeNoteId) ?? 0
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [scrollMemory, activeNoteId])

  const chapter = note ? chapters.find((c) => c.id === note.chapterId) : null
  const subject = chapter ? subjects.find((s) => s.id === chapter.subjectId) : null

  const stats = useMemo(() => {
    if (!note) return { words: 0, chars: 0 }
    // images are stored as data URLs in the markdown — exclude them from the stats
    const withoutImages = note.content.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    const trimmed = withoutImages.trim()
    return {
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      chars: withoutImages.length,
    }
  }, [note])

  // ---------- note actions ----------

  const handleContentChange = (markdown: string) => {
    if (note) updateNote(note.id, { content: markdown })
  }

  const copyMarkdown = async () => {
    if (!note) return
    try {
      await navigator.clipboard.writeText(`# ${note.title}\n\n${note.content}`)
      toast({ title: 'Copied', description: 'Note copied to clipboard as Markdown.' })
    } catch {
      toast({ title: 'Copy failed', description: 'Clipboard is unavailable.', variant: 'destructive' })
    }
  }

  const downloadMarkdown = () => {
    if (!note) return
    const blob = new Blob([`# ${note.title}\n\n${note.content}`], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(note.title || 'note').replace(/[^\w-]+/g, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'Downloaded', description: 'Note exported as a Markdown file.' })
  }

  // ---------- toolbar helpers ----------

  const tryWrap = (prefix: string, suffix: string, placeholder: string) => {
    const ok = editorRef.current?.wrapSelection(prefix, suffix, placeholder)
    if (!ok) {
      toast({
        title: 'Click into a text block first',
        description: 'Inline formatting applies to the block you are editing.',
      })
    }
  }

  const insertTemplate = (insert: string) => {
    const { tex, isBlock } = unwrapTemplate(insert)
    if (isBlock) editorRef.current?.insertMathBlock(tex)
    else editorRef.current?.insertInlineOrBlock(tex)
  }

  // ---------- formula maker: visual equation builder ----------

  const handleFormulaMakerInsert = (latex: string) => {
    editorRef.current?.insertFormulaBlock(latex)
    setFormulaMakerOpen(false)
    toast({
      title: 'Formula inserted',
      description: 'Your equation was added to the note as a LaTeX block.',
    })
  }

  // ---------- image flows: upload / clipboard / whiteboard ----------

  const warnIfLarge = (results: { bytes: number }[]) => {
    const biggest = results.reduce((m, r) => Math.max(m, r.bytes), 0)
    if (biggest > LARGE_IMAGE_BYTES) {
      toast({
        title: 'Large image stored',
        description: `${formatBytes(biggest)} after compression — browser storage is ~5 MB, so keep an eye on it (use Export for backups).`,
      })
    }
  }

  const handleImageAction = (kind: ImageAction) => {
    if (!note) return
    if (kind === 'upload') {
      imageInputRef.current?.click()
      return
    }
    if (kind === 'whiteboard') {
      setWhiteboardInitial(null)
      setAnnotateTargetId(null)
      setWhiteboardOpen(true)
      return
    }
    // clipboard read (needs the async Clipboard API — a plain click can't read it)
    void (async () => {
      try {
        if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
          throw new Error('unsupported')
        }
        const items = await navigator.clipboard.read()
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith('image/'))
          if (!type) continue
          const blob = await item.getType(type)
          const processed = await processImageFile(blob)
          editorRef.current?.insertImage(processed.dataUrl)
          warnIfLarge([processed])
          toast({
            title: 'Image inserted',
            description: `Pasted from clipboard · ${formatBytes(processed.bytes)}`,
          })
          return
        }
        toast({
          title: 'No image in the clipboard',
          description: 'Copy an image first — or just press Ctrl+V inside the note.',
        })
      } catch {
        toast({
          title: 'Clipboard read unavailable',
          description: 'Click inside the note and press Ctrl+V to paste the image directly.',
        })
      }
    })()
  }

  const handleImageFiles = (files: File[]) => {
    if (!files.length || !note) return
    void (async () => {
      const results: { dataUrl: string; bytes: number }[] = []
      for (const f of files) {
        try {
          results.push(await processImageFile(f))
        } catch {
          toast({
            title: 'Could not read image',
            description: f.name,
            variant: 'destructive',
          })
        }
      }
      if (!results.length) return
      editorRef.current?.insertImages(results.map((r) => r.dataUrl))
      warnIfLarge(results)
      toast({
        title: results.length === 1 ? 'Image added' : `${results.length} images added`,
        description: results.map((r) => formatBytes(r.bytes)).join(' · '),
      })
    })()
  }

  const handleAnnotateImage = (blockId: string, src: string) => {
    setWhiteboardInitial(src)
    setAnnotateTargetId(blockId)
    setWhiteboardOpen(true)
  }

  const handleWhiteboardInsert = (dataUrl: string) => {
    if (annotateTargetId) {
      editorRef.current?.replaceImage(annotateTargetId, dataUrl)
      toast({ title: 'Image updated', description: 'Whiteboard drawing replaced the image.' })
    } else {
      editorRef.current?.insertImage(dataUrl)
      toast({ title: 'Sketch inserted', description: 'Your whiteboard drawing is now in the note.' })
    }
    setWhiteboardOpen(false)
  }

  // ---------- render ----------

  if (!note) {
    const hasChapters = chapters.length > 0
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <FileText className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium">No note selected</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {hasChapters
            ? 'Pick a note from the list, or create a new one to start writing.'
            : 'Create a subject and a chapter first, then add notes.'}
        </p>
        {hasChapters && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const currentChapter = useNotepadStore.getState().selectedChapterId
              if (currentChapter) addNote(currentChapter)
            }}
          >
            New note
          </Button>
        )}
      </div>
    )
  }

  const mathTemplates = FORMULA_TEMPLATES.filter((t) => t.category === 'math')
  const chemTemplates = FORMULA_TEMPLATES.filter((t) => t.category === 'chem')

  return (
    <div
      className="flex h-full min-w-0 flex-col"
      // focusing anything in the pane (a block, the title, the top bar)
      // brings the toolbar back — writing at the bottom of a long note must
      // never leave you without it
      onFocusCapture={onRevealToolbar}
    >
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        {onBack && focusMode === 'off' && (
          <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Back to notes</span>
          </Button>
        )}
        {onOpenSidebar && focusMode === 'off' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 lg:hidden"
            onClick={onOpenSidebar}
            title="Subjects"
          >
            <PanelLeft className="h-4 w-4" />
            <span className="sr-only">Open subjects</span>
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
          {subject && (
            <>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: subject.color }}
                aria-hidden
              />
              <span className="shrink-0">{subject.name}</span>
              <span aria-hidden className="opacity-50">/</span>
            </>
          )}
          {chapter && <span className="truncate">{chapter.name}</span>}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Exit focus stays a direct control while a focus mode is on */}
          {onExitFocus && focusMode !== 'off' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onExitFocus}
              title={
                focusMode === 'fullscreen'
                  ? 'Exit fullscreen (Esc)'
                  : 'Exit full area (Esc)'
              }
              aria-label={
                focusMode === 'fullscreen' ? 'Exit fullscreen' : 'Exit full area view'
              }
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
          )}

          {/* V10.2 reading view — a one-click clean read-only layout while
              editing; hidden in focus mode, where the point is writing */}
          {focusMode === 'off' && !reading && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setReading(true)}
              title="Reading view — clean read-only layout (Esc exits)"
              aria-label="Enter reading view"
              data-testid="reading-view-toggle"
            >
              <BookOpenText className="h-4 w-4" />
            </Button>
          )}
          {reading && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 gap-1.5 px-2.5"
              onClick={() => setReading(false)}
              title="Exit reading view — back to the editor (Esc)"
              aria-label="Exit reading view"
              data-testid="reading-exit"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
          )}

          {/* Print — always-needed, one click away beside the reading toggle
              (Ctrl+P works too); printing from reading view is natural since
              both render the same markdown pipeline */}
          {onPrint && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2.5"
              onClick={onPrint}
              title="Print (Ctrl+P)"
              aria-label="Print note"
              data-testid="editor-print-button"
            >
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print</span>
            </Button>
          )}

          {/* Toolbar pin — keep the formatting toolbar always visible, or let
              it slide away with the app header while scrolling for extra space
              (back by request — this one is always needed) */}
          {!reading && onToggleToolbarPinned && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={
                toolbarPinned
                  ? 'Unpin toolbar — it will auto-hide while scrolling'
                  : 'Pin toolbar — always visible'
              }
              title={
                toolbarPinned
                  ? 'Unpin toolbar (auto-hides while scrolling)'
                  : 'Pin toolbar (always visible)'
              }
              data-testid="toolbar-pin-button"
              onClick={onToggleToolbarPinned}
            >
              {toolbarPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
            </Button>
          )}

          {/* Explicit hide — the toolbar stays hidden no matter what (scrolling
              up, focusing the editor, switching notes, focus modes) until it
              is explicitly shown again from this same button (back by request) */}
          {!reading && onToggleToolbarHidden && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={
                toolbarDismissed
                  ? 'Show toolbar — bring the formatting toolbar back'
                  : 'Hide toolbar — stays hidden until you show it again'
              }
              title={
                toolbarDismissed
                  ? 'Show toolbar (bring the formatting toolbar back)'
                  : 'Hide toolbar (stays hidden until you show it again)'
              }
              data-testid="toolbar-toggle-button"
              onClick={onToggleToolbarHidden}
            >
              {toolbarDismissed ? (
                <PanelTopOpen className="h-4 w-4" />
              ) : (
                <PanelTopClose className="h-4 w-4" />
              )}
            </Button>
          )}

          {/* Note menu — the focus modes (full area / fullscreen) plus the
              note actions (pin, copy, export, delete); print and the toolbar
              pin/show buttons sit directly on the bar since they are always
              needed */}
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Note options</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {/* view — only meaningful in the editor */}
            {!reading && (
              <>
                {onEnterFocus && (
                  <DropdownMenuItem onClick={() => onEnterFocus('area')}>
                    <RectangleHorizontal className="h-4 w-4" /> Full area view
                    <span className="ml-auto text-[10px] text-muted-foreground">hide panels</span>
                  </DropdownMenuItem>
                )}
                {onEnterFocus && (
                  <DropdownMenuItem
                    className="hidden lg:flex"
                    onClick={() => onEnterFocus('fullscreen')}
                  >
                    <Maximize2 className="h-4 w-4" /> Fullscreen
                    <span className="ml-auto text-[10px] text-muted-foreground">window chrome too</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => togglePin(note.id)}>
              {note.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              {note.pinned ? 'Unpin note' : 'Pin note'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyMarkdown}>
              <Copy className="h-4 w-4" /> Copy as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={downloadMarkdown}>
              <Download className="h-4 w-4" /> Export .md file
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" /> Delete note
            </DropdownMenuItem>
          </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Toolbar — two fixed rows (never wraps: heights stay deterministic,
          and each row scrolls horizontally when the pane is narrow). The
          outer 0fr/1fr grid row animates to whatever the rows measure, so
          the collapse never needs a hardcoded height. Hidden entirely while
          reading — reading mode is chrome-free. */}
      {!reading && (
      <div
        className={cn(
          'grid shrink-0 transition-[grid-template-rows] duration-200 ease-out',
          toolbarHidden ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
        )}
        inert={toolbarHidden}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-b bg-muted/30">
            {/* row 1 — block structure & text formatting */}
            <div
              className="toolbar-scroll flex items-center gap-0.5 overflow-x-auto px-3 py-1.5"
              role="toolbar"
              aria-label="Formatting"
            >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 font-mono text-xs">
                  <span className="font-bold">H</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                  <span className="sr-only">Heading</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => editorRef.current?.transformActive('h1')}>
                  <Heading1 className="h-4 w-4" /> Heading 1
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editorRef.current?.transformActive('h2')}>
                  <Heading2 className="h-4 w-4" /> Heading 2
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => editorRef.current?.transformActive('h3')}>
                  <Heading3 className="h-4 w-4" /> Heading 3
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Separator orientation="vertical" className="mx-1 h-5" />

            <ToolbarButton label="Bold (Ctrl+B)" onClick={() => tryWrap('**', '**', 'bold text')}>
              <span className="text-[13px] font-bold">B</span>
            </ToolbarButton>
            <ToolbarButton label="Italic (Ctrl+I)" onClick={() => tryWrap('*', '*', 'italic text')}>
              <Italic className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton label="Inline code (Ctrl+E)" onClick={() => tryWrap('`', '`', 'code')}>
              <Code className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Label — mark words as important (Ctrl+Shift+L)"
              onClick={() => tryWrap('==', '==', 'important term')}
            >
              <Tag className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="mx-1 h-5" />

            <ToolbarButton
              label="Bulleted list"
              onClick={() => editorRef.current?.transformActive('bullet')}
            >
              <List className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Numbered list"
              onClick={() => editorRef.current?.transformActive('numbered')}
            >
              <ListOrdered className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="To-do list"
              onClick={() => editorRef.current?.transformActive('todo')}
            >
              <ListTodo className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton label="Quote" onClick={() => editorRef.current?.transformActive('quote')}>
              <Quote className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="mx-1 h-5" />

            <ToolbarButton
              label="Table"
              onClick={() => editorRef.current?.transformActive('table')}
            >
              <Table className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Code block"
              onClick={() => editorRef.current?.transformActive('code')}
            >
              <Code className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Divider"
              onClick={() => editorRef.current?.transformActive('divider')}
            >
              <Minus className="h-4 w-4" />
            </ToolbarButton>
            </div>

            {/* row 2 — math, chemistry, images & whiteboard */}
            <div
              className="toolbar-scroll flex items-center gap-0.5 overflow-x-auto border-t border-border/60 px-3 py-1.5"
              role="toolbar"
              aria-label="Insert"
            >
            <ToolbarButton
              label="Inline math — $…$"
              onClick={() => tryWrap('$', '$', 'x^2')}
              className="font-serif"
            >
              <span className="font-serif text-[15px]">x</span>
            </ToolbarButton>
            <ToolbarButton
              label="Equation block"
              onClick={() => editorRef.current?.insertMathBlock()}
            >
              <Sigma className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Chemical equation"
              onClick={() => editorRef.current?.insertMathBlock('\\ce{}', -1)}
            >
              <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </ToolbarButton>

            {/* Formula templates */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-xs"
                  title="Insert a formula template"
                >
                  <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Formulas
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[340px]">
                <DropdownMenuItem
                  onClick={() => setFormulaMakerOpen(true)}
                  className="gap-2"
                >
                  <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="flex-1 font-medium">Formula maker…</span>
                  <span className="text-[10px] text-muted-foreground">visual</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                  <FlaskConical className="h-3.5 w-3.5" /> Chemistry
                </DropdownMenuLabel>
                {chemTemplates.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    className="flex items-center justify-between gap-3"
                    onClick={() => insertTemplate(t.insert)}
                  >
                    <span className="min-w-0 truncate text-xs">{t.label}</span>
                    <Latex
                      tex={t.preview}
                      className="max-w-[150px] shrink-0 overflow-hidden text-muted-foreground"
                    />
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                  <Sigma className="h-3.5 w-3.5" /> Mathematics
                </DropdownMenuLabel>
                {mathTemplates.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    className="flex items-center justify-between gap-3"
                    onClick={() => insertTemplate(t.insert)}
                  >
                    <span className="min-w-0 truncate text-xs">{t.label}</span>
                    <Latex
                      tex={t.preview}
                      className="max-w-[150px] shrink-0 overflow-hidden text-muted-foreground"
                    />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Image insert dropdown — upload / clipboard / whiteboard */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-xs"
                  title="Insert an image"
                >
                  <ImageIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Images
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuItem onClick={() => handleImageAction('upload')}>
                  <ImagePlus className="h-4 w-4" />
                  <span className="flex-1">Upload image…</span>
                  <span className="text-[10px] text-muted-foreground">file</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleImageAction('clipboard')}>
                  <Clipboard className="h-4 w-4" />
                  <span className="flex-1">Paste from clipboard</span>
                  <span className="text-[10px] text-muted-foreground">Ctrl+V</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleImageAction('whiteboard')}>
                  <Brush className="h-4 w-4" />
                  <span className="flex-1">Draw on whiteboard…</span>
                  <span className="text-[10px] text-muted-foreground">sketch</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                  You can also drag &amp; drop image files onto the note, or just press Ctrl+V while
                  writing.
                </p>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="ml-auto flex items-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs"
                onClick={onOpenCheatSheet}
                title="LaTeX & chemistry syntax guide"
              >
                <BookOpen className="h-4 w-4" />
                <span className="hidden md:inline">Cheat sheet</span>
              </Button>
            </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Title — centred to a comfortable reading width in a focus mode or
          while reading; a static heading replaces the textarea in reading
          mode, so nothing about the note looks editable */}
      <div
        className={cn(
          'shrink-0 px-4 pt-4 md:px-6',
          (focusMode !== 'off' || reading) && 'mx-auto w-full max-w-3xl px-6',
        )}
      >
        {reading ? (
          <h1
            data-testid="reading-title"
            className="block w-full px-0 py-0.5 text-xl font-bold tracking-tight md:text-2xl"
          >
            {note.title || 'Untitled note'}
          </h1>
        ) : (
          <textarea
          ref={titleRef}
          value={note.title}
          onChange={(e) => {
            // pasted line breaks collapse to spaces — a title is one logical line
            updateNote(note.id, { title: e.target.value.replace(/[\r\n]+/g, ' ') })
            autoResize(e.currentTarget)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault()
          }}
          placeholder="Untitled note"
          rows={1}
          className="block w-full resize-none overflow-hidden border-none bg-transparent px-0 py-0.5 text-xl font-bold tracking-tight shadow-none outline-none placeholder:text-muted-foreground focus-visible:outline-none md:text-2xl"
          aria-label="Note title"
          maxLength={120}
        />
        )}
      </div>

      {/* Body — WYSIWYG block editor, or the rendered note in reading mode
          (same scroll container, so scroll memory keeps working) */}
      <div
        ref={bodyRef}
        data-arrange-scroll
        data-testid={reading ? 'reading-view' : undefined}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-6',
          (focusMode !== 'off' || reading) && 'mx-auto w-full max-w-3xl px-6',
        )}
      >
        {reading ? (
          <MarkdownPreview content={note.content} className="pb-8" />
        ) : (
          <BlockEditor
            key={note.id}
            ref={editorRef}
            noteId={note.id}
            content={note.content}
            onChange={handleContentChange}
            onImageAction={handleImageAction}
            onFormulaMaker={() => setFormulaMakerOpen(true)}
            onAnnotateImage={handleAnnotateImage}
          />
        )}
      </div>

      {/* Stats bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px] text-muted-foreground md:px-6">
        <span className="tabular-nums">{stats.words} words</span>
        <span className="tabular-nums">{stats.chars} characters</span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          Saved locally
        </span>
        <span>
          Updated {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
        </span>
      </div>

      {/* Formula maker — full-screen visual equation builder */}
      <FormulaMakerDialog
        open={formulaMakerOpen}
        onOpenChange={(open) => {
          setFormulaMakerOpen(open)
          // closed without inserting — forget where the / or + menu was opened
          if (!open) editorRef.current?.clearPendingFormula()
        }}
        onInsert={handleFormulaMakerInsert}
      />

      {/* Whiteboard — draw & insert (also used to annotate images) */}
      <Whiteboard
        open={whiteboardOpen}
        onOpenChange={(open) => {
          setWhiteboardOpen(open)
          if (!open) {
            setWhiteboardInitial(null)
            setAnnotateTargetId(null)
          }
        }}
        onInsert={handleWhiteboardInsert}
        initialImage={whiteboardInitial}
      />

      {/* Hidden image file input (upload flow) */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-image-upload
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
          e.target.value = '' // allow picking the same file again
          handleImageFiles(files)
        }}
        aria-label="Upload images"
      />

      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{note.title || 'Untitled note'}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The note and all of its content will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                deleteNote(note.id)
                setConfirmDelete(false)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ToolbarButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('h-8 w-8', className)}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </Button>
  )
}
