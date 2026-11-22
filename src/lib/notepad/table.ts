/**
 * Table helpers for the table maker — pure string/array logic, no React.
 *
 * Tables live in notes as `table` blocks holding a GitHub-flavoured markdown
 * table (see blocks.ts). The table maker edits a grid of cells and converts
 * it to that markdown on insert; it can also import a raw LaTeX tabular
 * (the syntax students paste out of textbooks / Overleaf).
 */

export type TableGrid = string[][]

/** default starter grid — a header row plus two body rows × 3 columns */
export function defaultGrid(): TableGrid {
  return [
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
  ]
}

export const GRID_MIN_ROWS = 1
export const GRID_MIN_COLS = 1
export const GRID_MAX_ROWS = 60
export const GRID_MAX_COLS = 30

/** clone with every row padded/truncated to `cols` columns */
function normalise(rows: string[][], cols: number): TableGrid {
  return rows.map((r) => {
    const next = r.slice(0, cols)
    while (next.length < cols) next.push('')
    return next
  })
}

/** split a row on top-level separators, honouring backslash escapes */
function splitCells(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && line[i + 1] === sep) {
      cur += sep // unescape the separator itself
      i++
      continue
    }
    if (ch === '\\' && line[i + 1] === '\\') {
      cur += '\\\\' // keep markdown's escaped backslash intact
      i++
      continue
    }
    if (ch === sep) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

/** markdown pipe-escape for cell content */
function escapeCell(text: string): string {
  return text
    .replace(/\\\|/g, '\\\\|') // normalise existing escapes first
    .replace(/\|/g, '\\|')
}

/** is this markdown line the | --- | --- | separator row? */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c))
}

/** parse a markdown table (the block's stored text) → grid, or null */
export function parseMarkdownTable(md: string): TableGrid | null {
  const lines = md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.length > 1)
  if (lines.length === 0) return null
  const rows = lines
    .map((l) => splitCells(l.replace(/^\|/, '').replace(/\|$/, ''), '|'))
    .filter((cells) => !isSeparatorRow(cells))
  if (rows.length === 0) return null
  const cols = Math.max(...rows.map((r) => r.length))
  return normalise(rows, cols)
}

/** build the markdown table text the editor stores in a table block */
export function gridToMarkdown(grid: TableGrid): string {
  const rows = grid.length > 0 ? grid : defaultGrid()
  const cols = Math.max(...rows.map((r) => r.length), GRID_MIN_COLS)
  const norm = normalise(rows, cols)
  const line = (cells: string[]) => `| ${cells.map(escapeCell).join(' | ')} |`
  const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
  return [line(norm[0]), sep, ...norm.slice(1).map(line)].join('\n')
}

/** strip the lightest LaTeX markup from a cell — keep math ($…$) as-is */
function cleanLatexCell(raw: string): string {
  let s = raw.trim()
  // protect inline math spans first — \ce/\text inside $…$ must survive
  const math: string[] = []
  s = s.replace(/\$[^$]*\$/g, (m) => {
    math.push(m)
    return `\u0000${math.length - 1}\u0000`
  })
  // \multicolumn{2}{c}{text} / \multirow → keep the text part
  s = s.replace(/\\(?:multirow|multicolumn)\{[^}]*\}\{[^}]*\}\{([\s\S]*?)\}/g, '$1')
  // text-formatting commands → keep their argument
  s = s.replace(/\\(textbf|textit|texttt|emph|text|textrm|textsc)\{([\s\S]*?)\}/g, '$2')
  // booktabs / rules / spacing / alignment helpers
  s = s.replace(
    /\\(hline|cline\{[^}]*\}|toprule|midrule|bottomrule|rowcolor\{[^}]*\}|arraybackslash|noalign\{[^}]*\})/g,
    '',
  )
  s = s.replace(/\\(centering|raggedright|raggedleft|small|footnotesize|large)/g, '')
  // drop leftover lone letter-commands we don't understand (\quad, \vspace{..}…)
  s = s.replace(/\\[a-zA-Z]+(\[[^\]]*\])?(\{[^{}]*\})?/g, '')
  s = s.replace(/\\([{}&%#_$])/g, '$1') // unescape LaTeX specials
  // restore the math spans
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => math[Number(i)] ?? '')
  return s.trim()
}

/**
 * Parse a raw LaTeX tabular (tabular / tabularx / longtable) into a grid.
 * Returns null when no environment / no rows are found — the dialog shows
 * an inline error instead of silently clearing the grid.
 */
export function parseLatexTable(src: string): TableGrid | null {
  const env = src.match(
    /\\begin\{(tabular\*?|tabularx|longtable)\}([\s\S]*?)\\end\{\1\}/,
  )
  if (!env) return null
  let body = env[2]
  // skip the column-spec argument right after \begin{tabular}{|l|c|...|}
  const spec = body.match(/^\s*(\{(?:[^{}]|\{[^{}]*\})*\})/)
  if (spec) body = body.slice(spec[1].length)
  // drop rules / spacing / footnote rows
  body = body.replace(
    /\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\}|rowcolor\{[^}]*\}|arraybackslash|specialrule\{[^}]*\}\{[^}]*\}\{[^}]*\}|addlinespace(\[[^\]]*\])?|noalign\{[^}]*\}|centering|small|footnotesize|large)/g,
    '',
  )
  const rawRows = body
    .split(/\\\\(?:\[[^\]]*\])?/) // \\ and \\[4pt] end a row (non-capturing — split must not leak groups)
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
  const rows: string[][] = []
  for (const row of rawRows) {
    const cells = splitCells(row.replace(/\\\\$/, ''), '&').map(cleanLatexCell)
    if (cells.every((c) => c === '')) continue // trailing \\ artifact
    rows.push(cells)
  }
  if (rows.length === 0 || rows.every((r) => r.every((c) => c === ''))) return null
  const cols = Math.max(...rows.map((r) => r.length))
  return normalise(rows, cols)
}
