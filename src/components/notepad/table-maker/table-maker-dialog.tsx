'use client'

import { useEffect, useRef, useState } from 'react'
import { Braces, Columns3, Minus, Plus, Rows3, Table, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DeferredLoading, useDeferredMount } from '../deferred'
import {
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  GRID_MIN_COLS,
  GRID_MIN_ROWS,
  defaultGrid,
  gridToMarkdown,
  parseLatexTable,
  parseMarkdownTable,
  type TableGrid,
} from '@/lib/notepad/table'
import { cn } from '@/lib/utils'

interface TableMakerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** markdown table pre-filled when the dialog edits an existing block */
  initialMarkdown?: string | null
  /** insert the built table into the note (markdown table source) */
  onInsert: (markdown: string) => void
}

interface CellPos {
  r: number
  c: number
}

/**
 * Full-screen table maker (V10.4) — the grid counterpart of the formula
 * maker. The workspace is a click-to-edit grid: row 0 is the table header,
 * every cell is one click away from an inline editor. The top bar carries
 * Insert — and, to its left, a LaTeX importer that turns a raw
 * \begin{tabular}…\end{tabular} into the grid; the toolbar row below it
 * holds the structural options (add/delete row/column, operating on the
 * selected cell, or the last one when nothing is selected).
 *
 * Grid state lives HERE (outside the Radix portal, like the formula maker's
 * tokens) so a half-built table survives the dialog being closed and
 * reopened; an initialMarkdown prop syncs it when an existing block is
 * loaded for editing.
 */
export function TableMakerDialog({ open, onOpenChange, initialMarkdown, onInsert }: TableMakerDialogProps) {
  const [grid, setGrid] = useState<TableGrid>(() => defaultGrid())
  // selected cell — drives the add/delete row/column ops (Excel-style: the
  // selection SURVIVES blurring into the toolbar, so tapping a toolbar button
  // never loses which row/column the user picked) — while `editing` additionally
  // swaps that cell into its inline input
  const [selected, setSelected] = useState<CellPos | null>(null)
  const [editing, setEditing] = useState(false)
  const [latexOpen, setLatexOpen] = useState(false)
  const [latexSrc, setLatexSrc] = useState('')
  const [latexError, setLatexError] = useState<string | null>(null)
  const ready = useDeferredMount(open)
  const cellInputRef = useRef<HTMLInputElement>(null)

  // closing the workspace also folds the import sheet and any cell editing
  useEffect(() => {
    if (!open) {
      setLatexOpen(false)
      setSelected(null)
      setEditing(false)
    }
  }, [open])

  // sync the grid on open: an existing table block loads for editing (parsed
  // from its markdown), a fresh open resets to the starter grid — the creator
  // should never re-offer the table from a finished previous session
  useEffect(() => {
    if (!open) return
    if (initialMarkdown) {
      const parsed = parseMarkdownTable(initialMarkdown)
      if (parsed) setGrid(parsed)
    } else {
      setGrid(defaultGrid())
    }
    setSelected(null)
    setEditing(false)
  }, [open, initialMarkdown])

  // opening the LaTeX importer starts from a clean slate
  useEffect(() => {
    if (latexOpen) {
      setLatexError(null)
      setLatexSrc('')
    }
  }, [latexOpen])

  const setCell = (r: number, c: number, text: string) => {
    setGrid((g) => g.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? text : cell)) : row)))
  }

  const cols = grid[0]?.length ?? GRID_MIN_COLS

  const addRow = () => {
    if (grid.length >= GRID_MAX_ROWS) return
    setGrid((g) => {
      const width = g[0]?.length ?? GRID_MIN_COLS
      const next = [...g]
      next.splice(selected ? selected.r + 1 : g.length, 0, Array.from({ length: width }, () => ''))
      return next
    })
    setSelected((a) => (a ? { ...a, r: a.r + 1 } : a))
  }

  const addColumn = () => {
    if (cols >= GRID_MAX_COLS) return
    setGrid((g) =>
      g.map((row) => {
        const next = [...row]
        next.splice(selected ? selected.c + 1 : row.length, 0, '')
        return next
      }),
    )
    setSelected((a) => (a ? { ...a, c: a.c + 1 } : a))
  }

  const deleteRow = () => {
    if (grid.length <= GRID_MIN_ROWS) return
    setGrid((g) => {
      if (g.length <= GRID_MIN_ROWS) return g
      const at = selected ? Math.min(selected.r, g.length - 1) : g.length - 1
      return g.filter((_, ri) => ri !== at)
    })
    setSelected(null)
    setEditing(false)
  }

  const deleteColumn = () => {
    if (cols <= GRID_MIN_COLS) return
    setGrid((g) => {
      if ((g[0]?.length ?? GRID_MIN_COLS) <= GRID_MIN_COLS) return g
      const at = selected ? Math.min(selected.c, (g[0]?.length ?? 1) - 1) : (g[0]?.length ?? 1) - 1
      return g.map((row) => row.filter((_, ci) => ci !== at))
    })
    setSelected(null)
    setEditing(false)
  }

  const handleInsert = () => {
    onInsert(gridToMarkdown(grid))
    setSelected(null)
    setEditing(false)
  }

  const handleLatexImport = () => {
    const parsed = parseLatexTable(latexSrc)
    if (!parsed) {
      setLatexError('No tabular found — paste a \\begin{tabular}…\\end{tabular} block.')
      return
    }
    setGrid(parsed)
    setSelected(null)
    setEditing(false)
    setLatexOpen(false)
  }

  // keyboard inside a cell: Enter → next row, Tab → next cell, Esc → done
  const cellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, pos: CellPos) => {
    const width = grid[0]?.length ?? GRID_MIN_COLS
    if (e.key === 'Enter') {
      e.preventDefault()
      const nextR = pos.r + 1
      if (nextR >= grid.length) setGrid((g) => [...g, Array.from({ length: width }, () => '')])
      setSelected({ r: nextR, c: pos.c })
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const forward = !e.shiftKey
      let { r, c } = pos
      if (forward) {
        c++
        if (c >= width) {
          c = 0
          r++
          if (r >= grid.length) setGrid((g) => [...g, Array.from({ length: width }, () => '')])
        }
      } else {
        c--
        if (c < 0) {
          c = width - 1
          r = Math.max(0, r - 1)
        }
      }
      setSelected({ r, c })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditing(false)
    }
  }

  // focus the inline editor whenever the edited cell changes (click or keys)
  useEffect(() => {
    if (editing && selected && cellInputRef.current) cellInputRef.current.focus()
  }, [editing, selected])

  const canDeleteRow = grid.length > GRID_MIN_ROWS
  const canDeleteCol = cols > GRID_MIN_COLS

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* overrides turn the centered card into a true full-screen workspace */}
      <DialogContent
        data-testid="table-maker-dialog"
        className="inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        aria-describedby={undefined}
      >
        {/* ---- top bar: identity + LaTeX import (left of Insert) + Insert ---- */}
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5 pr-4 sm:pr-14">
          <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 sm:flex dark:bg-sky-950 dark:text-sky-300">
            <Table className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm font-bold leading-tight">Table maker</DialogTitle>
            <DialogDescription className="hidden text-[11px] leading-tight sm:block">
              Click a cell to edit — row 1 is the header. The markdown types itself.
            </DialogDescription>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2.5"
              onClick={() => setLatexOpen(true)}
              title="Import a raw LaTeX tabular"
              aria-label="Import LaTeX table"
              data-testid="table-maker-import"
            >
              <Braces className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              <span className="hidden sm:inline">Import LaTeX</span>
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 px-2.5"
              onClick={handleInsert}
              title="Insert the table into the note"
              aria-label="Insert table into the note"
              data-testid="table-maker-insert"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Insert</span>
            </Button>
          </div>
        </div>

        {ready ? (
          <>
            {/* ---- structure toolbar: add/delete row/column on the selected cell ---- */}
            <div
              role="toolbar"
              aria-label="Table structure"
              className="toolbar-scroll flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-2"
              data-testid="table-maker-toolbar"
            >
              <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={addRow} data-testid="table-maker-add-row">
                <Rows3 className="h-4 w-4" /> <Plus className="h-3 w-3" /> Row
              </Button>
              <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={addColumn} data-testid="table-maker-add-column">
                <Columns3 className="h-4 w-4" /> <Plus className="h-3 w-3" /> Column
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                onClick={deleteRow}
                disabled={!canDeleteRow}
                title={selected ? `Delete row ${selected.r + 1}` : 'Delete the last row'}
                data-testid="table-maker-delete-row"
              >
                <Rows3 className="h-4 w-4" /> <Minus className="h-3 w-3" /> Row
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                onClick={deleteColumn}
                disabled={!canDeleteCol}
                title={selected ? `Delete column ${selected.c + 1}` : 'Delete the last column'}
                data-testid="table-maker-delete-column"
              >
                <Columns3 className="h-4 w-4" /> <Minus className="h-3 w-3" /> Column
              </Button>
              <span className="ml-auto shrink-0 pl-3 text-[11px] text-muted-foreground" aria-live="polite" data-testid="table-maker-status">
                {selected ? `Selected R${selected.r + 1}C${selected.c + 1}` : `${grid.length} rows × ${cols} columns`}
              </span>
            </div>

            {/* ---- workspace: the click-to-edit grid ---- */}
            <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4 sm:p-6" data-testid="table-maker-grid">
              <div className="mx-auto max-w-3xl overflow-hidden rounded-lg border bg-background shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse" aria-label="Table maker grid">
                    <tbody>
                      {grid.map((row, r) => (
                        <tr key={r} className="border-b last:border-b-0">
                          {row.map((cell, c) => {
                            const isSelected = selected?.r === r && selected?.c === c
                            const isEditing = isSelected && editing
                            const isHeader = r === 0
                            return (
                              <td
                                key={c}
                                className={cn(
                                  'border-r p-0 align-bottom last:border-r-0',
                                  isHeader ? 'bg-muted/70' : 'bg-background',
                                  isSelected && !isEditing && 'bg-accent/30',
                                )}
                              >
                                {isEditing ? (
                                  <input
                                    ref={cellInputRef}
                                    value={cell}
                                    aria-label={`Cell row ${r + 1} column ${c + 1}`}
                                    data-testid={`table-input-${r}-${c}`}
                                    onChange={(e) => setCell(r, c, e.target.value)}
                                    onKeyDown={(e) => cellKeyDown(e, { r, c })}
                                    onBlur={() => setEditing(false)}
                                    className="h-11 w-full min-w-[9rem] bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    aria-label={`Edit cell row ${r + 1} column ${c + 1}`}
                                    data-testid={`table-cell-${r}-${c}`}
                                    onClick={() => {
                                      setSelected({ r, c })
                                      setEditing(true)
                                    }}
                                    className={cn(
                                      'h-11 w-full min-w-[9rem] cursor-text px-3 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                                      isHeader && 'font-semibold',
                                      cell === '' && 'text-muted-foreground/40',
                                    )}
                                  >
                                    {cell === '' ? (
                                      <span aria-hidden>Empty</span>
                                    ) : (
                                      <span className="line-clamp-1">{cell}</span>
                                    )}
                                  </button>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="mx-auto mt-3 max-w-3xl text-[11px] text-muted-foreground">
                Click a cell to edit · Enter next row · Tab next cell · Esc done — the table inserts as a markdown
                table, and $…$ math inside cells renders live.
              </p>
            </div>
          </>
        ) : (
          <DeferredLoading label="Loading the table maker…" testId="table-maker-loading" />
        )}

        {/* ---- LaTeX import sheet ---- */}
        <Dialog open={latexOpen} onOpenChange={setLatexOpen}>
          <DialogContent
            data-testid="table-maker-latex-dialog"
            className="flex max-h-[85dvh] flex-col gap-0 p-0"
            aria-describedby={undefined}
          >
            <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3 pr-14">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                <Braces className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="truncate text-sm font-bold leading-tight">Import LaTeX table</DialogTitle>
                <DialogDescription className="truncate text-[11px] leading-tight">
                  Paste a tabular — cells split at &amp;, rows end at \\, math and \ce survive.
                </DialogDescription>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
              <textarea
                value={latexSrc}
                onChange={(e) => setLatexSrc(e.target.value)}
                spellCheck={false}
                aria-label="LaTeX table source"
                data-testid="table-maker-latex-source"
                placeholder={
                  '\\begin{tabular}{|l|c|}\n\\hline\nSalt & Solubility \\\\\n\\hline\n$\\ce{NaCl}$ & 35.9 g/L \\\\\n\\hline\n\\end{tabular}'
                }
                className="min-h-40 w-full flex-1 resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-5 outline-none placeholder:text-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
              />
              {latexError && (
                <p role="alert" className="text-xs text-destructive" data-testid="table-maker-latex-error">
                  {latexError}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1.5 border-t px-4 py-3 pr-14">
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5" onClick={() => setLatexOpen(false)}>
                <X className="h-4 w-4" /> Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5 px-2.5"
                onClick={handleLatexImport}
                disabled={latexSrc.trim() === ''}
                data-testid="table-maker-latex-import"
              >
                Import
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
