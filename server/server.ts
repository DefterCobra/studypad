/**
 * StudyPad self-host server (Bun).
 *
 * Serves the static export (`out/`, produced by `bun run build`) and, when a
 * sync token is configured, a tiny REST API that stores each user's pad on
 * disk so Cloud sync works across devices:
 *
 *   GET    /api/sync/status      -> { enabled: true }          (no auth)
 *   GET    /api/sync/:key        -> { rev, updatedAt, data }   (404 if none)
 *   PUT    /api/sync/:key        <- { baseRev, data }          -> { rev, updatedAt }
 *                                   409 + current copy if baseRev != server rev
 *   DELETE /api/sync/:key
 *
 * `key` is a user id (or `_users` for the profile registry). Every call but
 * /status needs `Authorization: Bearer <STUDYPAD_SYNC_TOKEN>`.
 *
 * Config (env, Bun auto-loads ./.env):
 *   STUDYPAD_MODE         selfhost (default) | static — static serves the site only, no sync API
 *   STUDYPAD_SYNC_TOKEN   shared secret; sync is disabled when unset
 *   STUDYPAD_DATA_DIR     where pads are stored (default ./data)
 *   STUDYPAD_OUT_DIR      static build to serve   (default ./out)
 *   PORT / HOST           listen address          (default 8383 / 127.0.0.1)
 */
import { timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'

/** `selfhost` (default): static site + cloud sync API. `static`: static site only, API off. */
const MODE = (process.env.STUDYPAD_MODE ?? 'selfhost').trim().toLowerCase()
if (MODE !== 'static' && MODE !== 'selfhost') {
  console.error(`STUDYPAD_MODE must be "static" or "selfhost" (got "${MODE}")`)
  process.exit(1)
}
const TOKEN = MODE === 'static' ? '' : (process.env.STUDYPAD_SYNC_TOKEN?.trim() ?? '')
const DATA_DIR = resolve(process.env.STUDYPAD_DATA_DIR ?? './data')
const OUT_DIR = resolve(process.env.STUDYPAD_OUT_DIR ?? './out')
const PORT = Number(process.env.PORT ?? 8383)
const HOST = process.env.HOST ?? '127.0.0.1'
/** pads can hold pasted images — allow big bodies */
const MAX_BODY = 256 * 1024 * 1024

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/

interface StoredPad {
  rev: number
  updatedAt: number
  data: string
}

if (!existsSync(join(OUT_DIR, 'index.html'))) {
  console.error(`No static build at ${OUT_DIR} — run \`bun run build\` first.`)
  process.exit(1)
}
if (TOKEN) mkdirSync(DATA_DIR, { recursive: true })
if (TOKEN && TOKEN.length < 16) {
  console.error('STUDYPAD_SYNC_TOKEN is too short (min 16 chars) — the server is public, use a long random value.')
  process.exit(1)
}

const padFile = (key: string) => join(DATA_DIR, `${key}.json`)

function readPad(key: string): StoredPad | null {
  try {
    return JSON.parse(readFileSync(padFile(key), 'utf8')) as StoredPad
  } catch {
    return null
  }
}

/** atomic write (tmp + rename) that keeps the previous version as .bak */
function writePad(key: string, pad: StoredPad): void {
  const file = padFile(key)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(pad))
  if (existsSync(file)) renameSync(file, `${file}.bak`)
  renameSync(tmp, file)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function authorized(req: Request): boolean {
  const header = req.headers.get('authorization') ?? ''
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(TOKEN)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function handleSync(req: Request, pathname: string): Promise<Response> {
  if (!TOKEN) return json({ enabled: false }, 404)
  const rest = pathname.slice('/api/sync/'.length)
  if (rest === 'status' && req.method === 'GET') return json({ enabled: true })

  if (!authorized(req)) {
    await Bun.sleep(400) // blunt brute-force guessing
    return json({ error: 'unauthorized' }, 401)
  }
  if (!KEY_RE.test(rest)) return json({ error: 'bad key' }, 400)

  if (req.method === 'GET') {
    const pad = readPad(rest)
    return pad ? json(pad) : json({ error: 'not found' }, 404)
  }

  if (req.method === 'PUT') {
    let body: { baseRev?: unknown; data?: unknown }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'bad json' }, 400)
    }
    if (typeof body.data !== 'string' || typeof body.baseRev !== 'number') {
      return json({ error: 'expected { baseRev: number, data: string }' }, 400)
    }
    const current = readPad(rest)
    const currentRev = current?.rev ?? 0
    if (body.baseRev !== currentRev) return json({ error: 'conflict', current }, 409)
    const next: StoredPad = { rev: currentRev + 1, updatedAt: Date.now(), data: body.data }
    writePad(rest, next)
    return json({ rev: next.rev, updatedAt: next.updatedAt })
  }

  if (req.method === 'DELETE') {
    rmSync(padFile(rest), { force: true })
    rmSync(`${padFile(rest)}.bak`, { force: true })
    return json({ ok: true })
  }

  return json({ error: 'method not allowed' }, 405)
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** static file lookup: exact, .html, /index.html; falls back to 404.html */
function serveStatic(pathname: string): Response {
  let rel: string
  try {
    rel = normalize(decodeURIComponent(pathname))
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  const candidates = [rel, `${rel}.html`, join(rel, 'index.html')]
  for (const c of candidates) {
    const full = join(OUT_DIR, c)
    if (full !== OUT_DIR && !full.startsWith(OUT_DIR + sep)) continue // path traversal
    const file = Bun.file(full)
    if (isFile(full)) {
      const immutable = rel.startsWith(`${sep}_next${sep}static`)
      return new Response(file, {
        headers: {
          'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      })
    }
  }
  const notFound = Bun.file(join(OUT_DIR, '404.html'))
  return new Response(notFound.size > 0 ? notFound : 'Not found', { status: 404 })
}

Bun.serve({
  hostname: HOST,
  port: PORT,
  maxRequestBodySize: MAX_BODY,
  async fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname.startsWith('/api/sync/')) return handleSync(req, pathname)
    if (pathname.startsWith('/api/')) return json({ error: 'not found' }, 404)
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
    return serveStatic(pathname)
  },
})

console.log(
  `StudyPad serving ${OUT_DIR} on http://${HOST}:${PORT} — mode ${MODE} — cloud sync ${TOKEN ? `ON (data: ${DATA_DIR})` : 'OFF (set STUDYPAD_SYNC_TOKEN)'}`,
)
