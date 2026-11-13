'use client'

/**
 * Storage backends for Cloud save. sync.ts speaks to one tiny interface
 * (get / put-with-revision / delete); each provider implements it:
 *
 *   server    the self-hosted StudyPad server (shared bearer token)
 *   supabase  a `studypad_pads` table, row-level security per signed-in user
 *   firebase  Firestore  studypad/{uid}/pads/*, security rules per signed-in user
 *
 * Supabase and Firebase run straight from the browser (their client keys are
 * public by design — security comes from RLS / rules + the user's sign-in),
 * so they work on GitHub Pages too. SDKs are imported lazily: nobody who never
 * turns cloud save on downloads them.
 */

export type Provider = 'server' | 'supabase' | 'firebase'

export interface SupabaseConfig {
  url: string
  anonKey: string
}
export interface FirebaseConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}
export interface CloudConfig {
  provider: Provider
  serverToken: string
  supabase: SupabaseConfig
  firebase: FirebaseConfig
}

export const EMPTY_CONFIG: CloudConfig = {
  provider: 'supabase',
  serverToken: '',
  supabase: { url: '', anonKey: '' },
  firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' },
}

export interface RemotePad {
  rev: number
  updatedAt: number
  data: string
}
export type PutResult = { ok: true; rev: number; updatedAt: number } | { ok: false; current: RemotePad | null }

export interface SyncBackend {
  get(key: string): Promise<RemotePad | null>
  /** compare-and-set: succeeds only if the stored revision equals baseRev (0 = nothing stored) */
  put(key: string, baseRev: number, data: string): Promise<PutResult>
  del(key: string): Promise<void>
}

export interface CloudAuth {
  /** email of the signed-in account, or null */
  currentUser(): Promise<string | null>
  signIn(email: string, password: string): Promise<void>
  /** `needsConfirm`: the provider wants the email confirmed before a session exists */
  signUp(email: string, password: string): Promise<{ needsConfirm: boolean }>
  signOut(): Promise<void>
}

export interface Connection {
  backend: SyncBackend
  /** null for the self-hosted server (token only) */
  auth: CloudAuth | null
}

export class AuthError extends Error {}

export function isConfigured(c: CloudConfig): boolean {
  switch (c.provider) {
    case 'server':
      return c.serverToken.trim() !== ''
    case 'supabase':
      return c.supabase.url.trim() !== '' && c.supabase.anonKey.trim() !== ''
    case 'firebase':
      return c.firebase.apiKey.trim() !== '' && c.firebase.projectId.trim() !== '' && c.firebase.appId.trim() !== ''
  }
}

// ---------------------------------------------------------------- server

function serverConnection(token: string): Connection {
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetch(`/api/sync/${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${token}`,
      },
    })
    if (res.status === 401) throw new AuthError('The server rejected the sync token.')
    return res
  }
  const backend: SyncBackend = {
    async get(key) {
      const res = await call(key)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      return (await res.json()) as RemotePad
    },
    async put(key, baseRev, data) {
      const res = await call(key, { method: 'PUT', body: JSON.stringify({ baseRev, data }) })
      if (res.status === 409) {
        const { current } = (await res.json()) as { current: RemotePad | null }
        return { ok: false, current }
      }
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const { rev, updatedAt } = (await res.json()) as { rev: number; updatedAt: number }
      return { ok: true, rev, updatedAt }
    },
    async del(key) {
      await call(key, { method: 'DELETE' })
    },
  }
  return { backend, auth: null }
}

// -------------------------------------------------------------- supabase

const SB_TABLE = 'studypad_pads'

export const SUPABASE_SETUP_SQL = `create table if not exists studypad_pads (
  user_id    uuid    not null default auth.uid(),
  key        text    not null,
  rev        integer not null,
  updated_at bigint  not null,
  data       text    not null,
  primary key (user_id, key)
);
alter table studypad_pads enable row level security;
create policy "own pads" on studypad_pads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());`

async function supabaseConnection(cfg: SupabaseConfig): Promise<Connection> {
  const { createClient } = await import('@supabase/supabase-js')
  const url = cfg.url.trim().replace(/\/+$/, '')
  let host = url
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error('The Supabase project URL is not a valid URL.')
  }
  const sb = createClient(url, cfg.anonKey.trim(), {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: `studypad-sb-${host}` },
  })

  /** map a PostgREST / fetch error onto the sync layer's error vocabulary */
  const raise = (e: { message: string; code?: string; status?: number }): never => {
    if (e.status === 401 || e.code === 'PGRST301' || /jwt/i.test(e.message)) {
      throw new AuthError('Supabase rejected the session — sign in again.')
    }
    if (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table/i.test(e.message)) {
      throw new Error('Table studypad_pads not found — run the setup SQL in the Supabase SQL editor.')
    }
    if (e.status === 0 || /failed to fetch|networkerror|load failed/i.test(e.message)) throw new TypeError(e.message)
    throw new Error(e.message)
  }
  const requireSession = async () => {
    const { data } = await sb.auth.getSession()
    if (!data.session) throw new AuthError('Not signed in to Supabase.')
  }

  const backend: SyncBackend = {
    async get(key) {
      await requireSession()
      const { data, error } = await sb.from(SB_TABLE).select('rev,updated_at,data').eq('key', key).maybeSingle()
      if (error) return raise(error)
      return data ? { rev: data.rev as number, updatedAt: Number(data.updated_at), data: data.data as string } : null
    },
    async put(key, baseRev, data) {
      await requireSession()
      const updatedAt = Date.now()
      if (baseRev === 0) {
        const { error } = await sb.from(SB_TABLE).insert({ key, rev: 1, updated_at: updatedAt, data })
        if (!error) return { ok: true, rev: 1, updatedAt }
        if (error.code === '23505') return { ok: false, current: await this.get(key) } // row already exists
        return raise(error)
      }
      const { data: rows, error } = await sb
        .from(SB_TABLE)
        .update({ rev: baseRev + 1, updated_at: updatedAt, data })
        .eq('key', key)
        .eq('rev', baseRev)
        .select('rev')
      if (error) return raise(error)
      if (!rows || rows.length === 0) return { ok: false, current: await this.get(key) }
      return { ok: true, rev: baseRev + 1, updatedAt }
    },
    async del(key) {
      await requireSession()
      const { error } = await sb.from(SB_TABLE).delete().eq('key', key)
      if (error) raise(error)
    },
  }

  const auth: CloudAuth = {
    async currentUser() {
      const { data } = await sb.auth.getSession()
      return data.session?.user.email ?? null
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw new AuthError(error.message)
    },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password })
      if (error) throw new AuthError(error.message)
      return { needsConfirm: !data.session }
    },
    async signOut() {
      await sb.auth.signOut()
    },
  }
  return { backend, auth }
}

// -------------------------------------------------------------- firebase

export const FIREBASE_SETUP_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /studypad/{uid}/pads/{id} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`

/** Firestore documents cap at 1 MiB, so a pad is stored as several chunk documents */
const FS_CHUNK_CHARS = 300_000
const FS_BATCH_CHUNKS = 4
let fbCounter = 0
let fbPrevApp: { delete: () => Promise<void> } | null = null

async function firebaseConnection(cfg: FirebaseConfig): Promise<Connection> {
  const [{ initializeApp, deleteApp }, authMod, fs] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ])
  if (fbPrevApp) await fbPrevApp.delete().catch(() => {})
  const app = initializeApp(
    {
      apiKey: cfg.apiKey.trim(),
      authDomain: cfg.authDomain.trim() || `${cfg.projectId.trim()}.firebaseapp.com`,
      projectId: cfg.projectId.trim(),
      appId: cfg.appId.trim(),
    },
    `studypad-${++fbCounter}`,
  )
  fbPrevApp = { delete: () => deleteApp(app) }
  const fbAuth = authMod.getAuth(app)
  const db = fs.getFirestore(app)

  const raise = (e: unknown): never => {
    const code = (e as { code?: string }).code ?? ''
    const message = e instanceof Error ? e.message : 'Firebase request failed.'
    if (code === 'permission-denied') {
      throw new Error('Firestore denied access — publish the security rules from the setup help.')
    }
    if (code === 'unauthenticated') throw new AuthError('Not signed in to Firebase.')
    if (code === 'unavailable' || code === 'auth/network-request-failed') throw new TypeError(message)
    if (code.startsWith('auth/')) throw new AuthError(message.replace(/^Firebase:\s*/, ''))
    throw e instanceof Error ? e : new Error(message)
  }
  const uid = async (): Promise<string> => {
    await fbAuth.authStateReady()
    if (!fbAuth.currentUser) throw new AuthError('Not signed in to Firebase.')
    return fbAuth.currentUser.uid
  }
  const padDoc = (u: string, id: string) => fs.doc(db, 'studypad', u, 'pads', id)
  const chunkId = (key: string, nonce: string, i: number) => `${key}~${nonce}~${i}`

  interface Meta {
    rev: number
    updatedAt: number
    nonce: string
    chunks: number
  }

  const deleteChunks = async (u: string, key: string, m: Meta | null) => {
    if (!m) return
    const batch = fs.writeBatch(db)
    for (let i = 0; i < m.chunks; i++) batch.delete(padDoc(u, chunkId(key, m.nonce, i)))
    await batch.commit().catch(() => {}) // best effort — orphans are harmless
  }

  const backend: SyncBackend = {
    async get(key) {
      try {
        const u = await uid()
        for (let attempt = 0; attempt < 3; attempt++) {
          const snap = await fs.getDoc(padDoc(u, key))
          if (!snap.exists()) return null
          const m = snap.data() as Meta
          const parts = await Promise.all(
            Array.from({ length: m.chunks }, (_, i) => fs.getDoc(padDoc(u, chunkId(key, m.nonce, i)))),
          )
          // a concurrent writer may have swapped the chunk set between the two reads — start over
          if (parts.every((p) => p.exists())) {
            return { rev: m.rev, updatedAt: m.updatedAt, data: parts.map((p) => p.data()!.part as string).join('') }
          }
        }
        throw new Error('Cloud copy changed while reading — will retry.')
      } catch (e) {
        return raise(e)
      }
    },
    async put(key, baseRev, data) {
      try {
        const u = await uid()
        const nonce = Math.random().toString(36).slice(2, 10)
        const parts: string[] = []
        for (let i = 0; i < data.length; i += FS_CHUNK_CHARS) parts.push(data.slice(i, i + FS_CHUNK_CHARS))
        if (parts.length === 0) parts.push('')

        // 1. stage the chunks under a fresh nonce (invisible until the meta doc points at them)
        for (let i = 0; i < parts.length; i += FS_BATCH_CHUNKS) {
          const batch = fs.writeBatch(db)
          parts.slice(i, i + FS_BATCH_CHUNKS).forEach((part, j) => {
            batch.set(padDoc(u, chunkId(key, nonce, i + j)), { part })
          })
          await batch.commit()
        }

        // 2. compare-and-set the meta doc
        const updatedAt = Date.now()
        let previous: Meta | null = null
        const won = await fs.runTransaction(db, async (tx) => {
          const snap = await tx.get(padDoc(u, key))
          previous = snap.exists() ? (snap.data() as Meta) : null
          if ((previous?.rev ?? 0) !== baseRev) return false
          tx.set(padDoc(u, key), { rev: baseRev + 1, updatedAt, nonce, chunks: parts.length } satisfies Meta)
          return true
        })

        if (!won) {
          await deleteChunks(u, key, { rev: 0, updatedAt: 0, nonce, chunks: parts.length })
          return { ok: false, current: await this.get(key) }
        }
        await deleteChunks(u, key, previous as Meta | null) // 3. drop the superseded chunk set
        return { ok: true, rev: baseRev + 1, updatedAt }
      } catch (e) {
        return raise(e)
      }
    },
    async del(key) {
      try {
        const u = await uid()
        const snap = await fs.getDoc(padDoc(u, key))
        if (!snap.exists()) return
        await deleteChunks(u, key, snap.data() as Meta)
        await fs.deleteDoc(padDoc(u, key))
      } catch (e) {
        raise(e)
      }
    },
  }

  const auth: CloudAuth = {
    async currentUser() {
      await fbAuth.authStateReady()
      return fbAuth.currentUser?.email ?? null
    },
    async signIn(email, password) {
      try {
        await authMod.signInWithEmailAndPassword(fbAuth, email, password)
      } catch (e) {
        raise(e)
      }
    },
    async signUp(email, password) {
      try {
        await authMod.createUserWithEmailAndPassword(fbAuth, email, password)
      } catch (e) {
        raise(e)
      }
      return { needsConfirm: false }
    },
    async signOut() {
      await authMod.signOut(fbAuth)
    },
  }
  return { backend, auth }
}

// ---------------------------------------------------------------- factory

let cached: { sig: string; conn: Promise<Connection> } | null = null

/** open (or reuse) the connection for a config; SDK clients are created once per distinct config */
export function openConnection(c: CloudConfig): Promise<Connection> {
  const sig = JSON.stringify(
    c.provider === 'server' ? [c.provider, c.serverToken] : c.provider === 'supabase' ? [c.provider, c.supabase] : [c.provider, c.firebase],
  )
  if (cached?.sig === sig) return cached.conn
  const conn =
    c.provider === 'server'
      ? Promise.resolve(serverConnection(c.serverToken.trim()))
      : c.provider === 'supabase'
        ? supabaseConnection(c.supabase)
        : firebaseConnection(c.firebase)
  cached = { sig, conn }
  conn.catch(() => {
    if (cached?.conn === conn) cached = null // let a corrected config retry
  })
  return conn
}
