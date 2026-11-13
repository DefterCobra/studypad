'use client'

/**
 * Cloud save — keeps each user's pad (and the profile list) in a backend of
 * your choice (Supabase, Firebase, or the self-hosted StudyPad server — see
 * sync-backends.ts), so notes follow you across devices.
 *
 * Supabase / Firebase work from any build, GitHub Pages included. The
 * self-hosted server option only appears when GET /api/sync/status answers.
 *
 * Model: IndexedDB stays the source of truth for the UI; the server holds a
 * copy per user with a revision counter. For every user we remember the
 * revision + content hash of the last successful sync, which makes "do I have
 * unsynced local edits?" a simple hash comparison — it survives reloads and
 * even periods when sync was switched off.
 *
 *   server newer, local untouched   -> pull (local copy is saved as a backup first)
 *   local edited, server unchanged  -> push
 *   both changed                    -> conflict: the user picks a side
 */
import { create } from 'zustand'
import { STORAGE_KEY } from './constants'
import { GUEST_USER_ID, getActiveUserId } from './active-user'
import { hasStoredData, readPersistedFor, writePersistedFor, clearUserPartition } from './idb-storage'
import { useNotepadStore } from './store'
import { useUsersStore, type PadUser } from './users'
import {
  AuthError,
  EMPTY_CONFIG,
  isConfigured,
  openConnection,
  type CloudConfig,
  type Connection,
  type RemotePad,
  type SyncBackend,
} from './sync-backends'

const REGISTRY_KEY = '_users'
const SETTINGS_LS = 'studypad-sync-v1'
const REMOVED_LS = 'studypad-sync-removed-v1'
const BACKUP_NAME = `${STORAGE_KEY}-presync-backup`
const PUSH_DEBOUNCE_MS = 2500

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'conflict'

interface SyncState {
  /** the self-hosted server answers and has sync enabled (null until probed) */
  serverAvailable: boolean | null
  /** cloud save switched on and connected */
  enabled: boolean
  /** saved provider settings (kept while cloud save is switched off) */
  config: CloudConfig
  /** signed-in account email for Supabase / Firebase */
  account: string | null
  /** bumps whenever the connection changes so the runner restarts its loops */
  epoch: number
  status: SyncStatus
  message: string
  lastSyncedAt: number | null
  /** both sides changed — waiting for the user's choice */
  conflict: { userId: string; remote: RemotePad } | null
  dialogOpen: boolean
  setDialogOpen: (open: boolean) => void
}

function loadSettings(): { enabled: boolean; config: CloudConfig } {
  try {
    const raw = window.localStorage.getItem(SETTINGS_LS)
    if (raw) {
      const p = JSON.parse(raw) as Partial<CloudConfig> & { enabled?: unknown; token?: unknown }
      const config: CloudConfig = {
        provider: p.provider === 'server' || p.provider === 'firebase' || p.provider === 'supabase' ? p.provider : 'server',
        // pre-V9 settings stored just the server token
        serverToken: typeof p.serverToken === 'string' ? p.serverToken : typeof p.token === 'string' ? p.token : '',
        supabase: { ...EMPTY_CONFIG.supabase, ...(p.supabase ?? {}) },
        firebase: { ...EMPTY_CONFIG.firebase, ...(p.firebase ?? {}) },
      }
      return { enabled: p.enabled === true, config }
    }
  } catch {
    // fall through
  }
  return { enabled: false, config: EMPTY_CONFIG }
}

function saveSettings(enabled: boolean, config: CloudConfig): void {
  try {
    window.localStorage.setItem(SETTINGS_LS, JSON.stringify({ enabled, ...config }))
  } catch {
    // session-only
  }
}

export const useSyncStore = create<SyncState>()((set) => ({
  serverAvailable: null,
  enabled: false,
  config: EMPTY_CONFIG,
  account: null,
  epoch: 0,
  status: 'off',
  message: '',
  lastSyncedAt: null,
  conflict: null,
  dialogOpen: false,
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
}))

const patch = (p: Partial<SyncState>) => useSyncStore.setState(p)

// ---------- per-user bookkeeping (localStorage) ----------

const revKey = (id: string) => `studypad-sync-rev-${id}`
const hashKey = (id: string) => `studypad-sync-hash-${id}`

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // cosmetic: worst case the next sync re-reconciles
  }
}
const getRev = (id: string) => Number(lsGet(revKey(id)) ?? 0) || 0
function markSynced(id: string, rev: number, hash: string): void {
  lsSet(revKey(id), String(rev))
  lsSet(hashKey(id), hash)
}

/** cyrb53 — fast non-cryptographic hash (crypto.subtle is unavailable on plain-http LAN origins) */
function hashOf(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${str.length}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`
}

// ---------- backend access ----------

/** the live connection for the saved config (SDKs load lazily on first use) */
async function backend(): Promise<SyncBackend> {
  return (await openConnection(useSyncStore.getState().config)).backend
}

const getRemote = async (key: string): Promise<RemotePad | null> => (await backend()).get(key)

function fail(e: unknown): void {
  if (e instanceof AuthError) {
    patch({ status: 'error', message: e.message })
  } else if (e instanceof TypeError) {
    patch({ status: 'offline', message: 'Cloud unreachable — will retry.' })
  } else {
    patch({ status: 'error', message: e instanceof Error ? e.message : 'Sync failed.' })
  }
}

/** does the self-hosted server offer sync? (404 on GitHub Pages and on servers without a token) */
export async function probeAvailability(): Promise<boolean> {
  // build-time switch: a `static` build never looks for a sync server
  if (process.env.NEXT_PUBLIC_STUDYPAD_MODE === 'static') {
    patch({ serverAvailable: false })
    return false
  }
  try {
    const res = await fetch('/api/sync/status', { cache: 'no-store' })
    const ok = res.ok && ((await res.json()) as { enabled?: boolean }).enabled === true
    patch({ serverAvailable: ok })
    return ok
  } catch {
    patch({ serverAvailable: false })
    return false
  }
}

export function initSyncSettings(): void {
  const { enabled, config } = loadSettings()
  const on = enabled && isConfigured(config)
  patch({ enabled: on, config, status: on ? 'idle' : 'off' })
  if (on && config.provider !== 'server') void refreshAccount()
}

async function refreshAccount(): Promise<void> {
  try {
    const conn = await openConnection(useSyncStore.getState().config)
    patch({ account: conn.auth ? await conn.auth.currentUser() : null })
  } catch {
    patch({ account: null })
  }
}

export interface Credentials {
  email: string
  password: string
  mode: 'signin' | 'signup'
}

/** Result of `connect`: ok, or a message to show next to the form */
export type ConnectResult = { ok: true } | { ok: false; message: string }

/**
 * Save the provider settings, sign in (Supabase / Firebase), verify the
 * backend is set up, then switch cloud save on. Without credentials an
 * existing session from an earlier sign-in is reused.
 */
export async function connect(config: CloudConfig, creds: Credentials | null): Promise<ConnectResult> {
  patch({ status: 'syncing', message: 'Connecting…' })
  try {
    if (!isConfigured(config)) throw new Error('Fill in the connection settings first.')
    const conn: Connection = await openConnection(config)
    let account: string | null = null
    if (conn.auth) {
      if (creds) {
        if (creds.mode === 'signup') {
          const { needsConfirm } = await conn.auth.signUp(creds.email.trim(), creds.password)
          if (needsConfirm) {
            patch({ status: 'off', message: '' })
            return { ok: false, message: 'Account created — confirm the email we sent, then sign in.' }
          }
        } else {
          await conn.auth.signIn(creds.email.trim(), creds.password)
        }
      }
      account = await conn.auth.currentUser()
      if (!account) throw new AuthError('Enter your email and password to sign in.')
    }
    await conn.backend.get(REGISTRY_KEY) // proves the table / rules / token work
    saveSettings(true, config)
    patch({ config, account, enabled: true, status: 'idle', message: '', conflict: null, epoch: useSyncStore.getState().epoch + 1 })
    return { ok: true }
  } catch (e) {
    patch({ enabled: false, status: 'off', message: '' })
    const message =
      e instanceof TypeError
        ? 'Could not reach the service — check the URL and your connection.'
        : e instanceof Error
          ? e.message
          : 'Connection failed.'
    return { ok: false, message }
  }
}

/** switch cloud save on/off without forgetting the saved settings or the sign-in */
export async function setCloudEnabled(on: boolean): Promise<boolean> {
  const { config } = useSyncStore.getState()
  if (!on) {
    saveSettings(false, config)
    patch({ enabled: false, status: 'off', message: '', conflict: null, lastSyncedAt: null, epoch: useSyncStore.getState().epoch + 1 })
    return true
  }
  if (!isConfigured(config)) return false
  const r = await connect(config, null) // reuses the stored session
  return r.ok
}

/** switch off and sign out of the provider (settings stay, password is never stored) */
export async function disconnect(): Promise<void> {
  const { config } = useSyncStore.getState()
  try {
    const conn = await openConnection(config)
    await conn.auth?.signOut()
  } catch {
    // already unreachable — local sign-out state is what matters
  }
  saveSettings(false, config)
  patch({ enabled: false, account: null, status: 'off', message: '', conflict: null, lastSyncedAt: null, epoch: useSyncStore.getState().epoch + 1 })
}

// ---------- pad sync ----------

/** set while a pulled copy is being loaded into the store */
let applying = false
/** reconciles are serialised so a focus event can't race a debounced push */
let chain: Promise<void> = Promise.resolve()
const enqueue = (job: () => Promise<void>): Promise<void> => (chain = chain.then(job, job))

async function applyRemote(userId: string, remote: RemotePad): Promise<void> {
  // never overwrite someone else's open workspace
  if (userId !== getActiveUserId()) return
  const previous = await readPersistedFor(userId)
  if (previous) await writePersistedFor(userId, previous, BACKUP_NAME) // safety net for pulls
  applying = true
  try {
    await writePersistedFor(userId, remote.data)
    await useNotepadStore.persist.rehydrate()
  } finally {
    applying = false
  }
  markSynced(userId, remote.rev, hashOf(remote.data))
}

async function pushPad(userId: string, baseRev: number): Promise<void> {
  const raw = await readPersistedFor(userId)
  if (raw == null) return
  const hash = hashOf(raw)
  const res = await (await backend()).put(userId, baseRev, raw)
  if (!res.ok) {
    const { current } = res
    if (current && hashOf(current.data) === hash) {
      markSynced(userId, current.rev, hash) // same content already there
      return
    }
    if (current) {
      patch({ status: 'conflict', conflict: { userId, remote: current }, dialogOpen: true, message: '' })
      return
    }
    // remote vanished between calls — retry once from scratch
    return pushPad(userId, 0)
  }
  markSynced(userId, res.rev, hash)
}

/**
 * Bring one user's pad in line with the server.
 * `initial` is true on the first run after entering a user: only then does
 * "nothing stored locally" reliably mean "this device has never seen this pad".
 */
function reconcile(userId: string, initial: boolean): Promise<void> {
  return enqueue(async () => {
    const s = useSyncStore.getState()
    if (!s.enabled || s.conflict) return
    patch({ status: 'syncing', message: '' })
    try {
      const remote = await getRemote(userId)
      const raw = await readPersistedFor(userId)
      const hash = raw != null ? hashOf(raw) : null
      const localRev = getRev(userId)
      const dirty = raw != null && hash !== lsGet(hashKey(userId))

      if (!remote) {
        if (raw != null) await pushPad(userId, 0)
      } else if (hash !== null && hashOf(remote.data) === hash) {
        markSynced(userId, remote.rev, hash) // identical content — just adopt the revision
      } else if (remote.rev === localRev) {
        if (dirty) await pushPad(userId, remote.rev)
      } else if (!dirty || (initial && localRev === 0 && !hasStoredData())) {
        await applyRemote(userId, remote)
      } else {
        patch({ status: 'conflict', conflict: { userId, remote }, dialogOpen: true })
        return
      }
      if (useSyncStore.getState().status === 'conflict') return
      patch({ status: 'synced', lastSyncedAt: Date.now(), message: '' })
    } catch (e) {
      fail(e)
    }
  })
}

/** resolve a conflict: take the server's copy, or overwrite it with this device's */
export function resolveConflict(choice: 'server' | 'device'): Promise<void> {
  return enqueue(async () => {
    const conflict = useSyncStore.getState().conflict
    if (!conflict) return
    patch({ status: 'syncing', conflict: null })
    try {
      if (choice === 'server') {
        await applyRemote(conflict.userId, conflict.remote)
      } else {
        await pushPad(conflict.userId, conflict.remote.rev)
      }
      if (useSyncStore.getState().status === 'conflict') return
      patch({ status: 'synced', lastSyncedAt: Date.now(), message: '' })
    } catch (e) {
      fail(e)
    }
  })
}

/** manual "Sync now" for the active user (registry first, then the pad) */
export async function syncNow(): Promise<void> {
  if (useSyncStore.getState().conflict) return
  await syncRegistry()
  const id = getActiveUserId()
  if (useUsersStore.getState().currentUserId === id) await reconcile(id, false)
}

/**
 * Keep one user's pad synced while their workspace is open. Returns cleanup.
 */
export function startPadSync(userId: string): () => void {
  void reconcile(userId, true)

  let timer: ReturnType<typeof setTimeout> | null = null
  const pending = () => {
    timer = null
    void enqueue(async () => {
      const s = useSyncStore.getState()
      if (!s.enabled || s.conflict) return
      // a profile deleted while edits were pending must not be resurrected on the server
      if (userId !== GUEST_USER_ID && !useUsersStore.getState().users.some((u) => u.id === userId)) return
      patch({ status: 'syncing' })
      try {
        await pushPad(userId, getRev(userId))
        if (useSyncStore.getState().status === 'conflict') return
        patch({ status: 'synced', lastSyncedAt: Date.now(), message: '' })
      } catch (e) {
        fail(e)
      }
    })
  }

  const unsubscribe = useNotepadStore.subscribe((s, prev) => {
    if (applying || getActiveUserId() !== userId) return // our own pull, or a user switch in progress
    if (
      s.notes === prev.notes &&
      s.chapters === prev.chapters &&
      s.subjects === prev.subjects &&
      s.flashcards === prev.flashcards &&
      s.quizzes === prev.quizzes
    ) {
      return
    }
    if (!useSyncStore.getState().enabled) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(pending, PUSH_DEBOUNCE_MS)
  })

  const onWake = () => {
    if (document.visibilityState === 'visible') void reconcile(userId, false)
  }
  document.addEventListener('visibilitychange', onWake)
  window.addEventListener('online', onWake)

  return () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onWake)
    window.removeEventListener('online', onWake)
    if (timer) {
      // leaving this user (switch / unmount) — flush edits that were waiting on the debounce
      clearTimeout(timer)
      pending()
    }
  }
}

// ---------- profile registry sync ----------

interface RegistryDoc {
  users: PadUser[]
  removed: string[]
}

function getRemoved(): string[] {
  try {
    const v: unknown = JSON.parse(lsGet(REMOVED_LS) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function parseRegistry(raw: string | undefined): RegistryDoc {
  try {
    const d = JSON.parse(raw ?? '') as Partial<RegistryDoc>
    return {
      users: Array.isArray(d.users) ? d.users.filter((u) => u && typeof u.id === 'string' && typeof u.name === 'string') : [],
      removed: Array.isArray(d.removed) ? d.removed.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return { users: [], removed: [] }
  }
}

/**
 * Merge the local profile list with the server's. Union by id (this device
 * wins on a clash); a deletion is a tombstone so removed profiles don't come
 * back from another device. Conflict-free, so a 409 just means "merge again".
 */
export function syncRegistry(): Promise<void> {
  return enqueue(async () => {
    const s = useSyncStore.getState()
    if (!s.enabled) return
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await getRemote(REGISTRY_KEY)
        const remoteDoc = parseRegistry(remote?.data)
        const removed = [...new Set([...getRemoved(), ...remoteDoc.removed])]
        const localUsers = useUsersStore.getState().users
        const currentId = useUsersStore.getState().currentUserId

        const byId = new Map<string, PadUser>()
        for (const u of remoteDoc.users) byId.set(u.id, u)
        for (const u of localUsers) byId.set(u.id, u)
        for (const id of removed) if (id !== currentId) byId.delete(id)
        byId.delete(GUEST_USER_ID)
        const merged = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt)

        // adopt the merge locally; profiles deleted elsewhere also lose their local partition
        const same =
          merged.length === localUsers.length && merged.every((u, i) => u.id === localUsers[i]?.id && u.name === localUsers[i]?.name)
        if (!same) {
          for (const u of localUsers) {
            if (!byId.has(u.id)) {
              lsSet(revKey(u.id), null)
              lsSet(hashKey(u.id), null)
              void clearUserPartition(u.id)
            }
          }
          useUsersStore.getState().replaceUsers(merged)
        }
        lsSet(REMOVED_LS, JSON.stringify(removed))

        const next: RegistryDoc = { users: merged, removed }
        if (remote && JSON.stringify(next) === JSON.stringify(remoteDoc)) return
        const res = await (await backend()).put(REGISTRY_KEY, remote?.rev ?? 0, JSON.stringify(next))
        if (!res.ok) continue // someone else wrote first — merge again
        return
      }
    } catch (e) {
      fail(e)
    }
  })
}

/** Keep the profile list synced (runs from the gate onwards). Returns cleanup. */
export function startRegistrySync(): () => void {
  void syncRegistry()
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = useUsersStore.subscribe((s, prev) => {
    if (s.users === prev.users) return
    // a locally deleted profile: tombstone it and drop its pad from the server
    const gone = prev.users.filter((u) => !s.users.some((x) => x.id === u.id)).map((u) => u.id)
    if (gone.length && useSyncStore.getState().enabled) {
      lsSet(REMOVED_LS, JSON.stringify([...new Set([...getRemoved(), ...gone])]))
      for (const id of gone) {
        lsSet(revKey(id), null)
        lsSet(hashKey(id), null)
        void backend().then((b) => b.del(id)).catch(() => {})
      }
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void syncRegistry(), 800)
  })
  return () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
  }
}
