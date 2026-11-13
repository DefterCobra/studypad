/**
 * IndexedDB-backed storage for the notepad store (via localforage),
 * partitioned per user.
 *
 * Replaces the old localStorage persistence — localStorage caps out at
 * ~5 MB, while IndexedDB comfortably holds hundreds of MB, which matters
 * once notes contain pasted images. localforage keeps the exact
 * getItem/setItem/removeItem shape zustand's persist middleware expects
 * and transparently falls back to localStorage only in the rare browsers
 * where IndexedDB is unavailable.
 *
 * Multi-user: every user gets their own object store (`u-<userId>`) inside
 * the shared `studypad` database, and the store above the persist middleware
 * calls setActiveUserId() before rehydrating, so reads and writes land in the
 * right partition. The storage layer itself stays stateless between users.
 *
 * Migration chain (each step only ever feeds Guest's partition, because
 * data from before multi-user existed belongs to Guest):
 *   1. the active user's own store is read first;
 *   2. a Guest read with an empty store migrates the pre-multiuser `kv`
 *      store across, then removes the original so "clear data" stays
 *      permanent and other (new) users never inherit it;
 *   3. a Guest read with nothing anywhere falls back to the oldest era —
 *      the pre-IndexedDB localStorage copy.
 */
import localforage from 'localforage'
import type { StateStorage } from 'zustand/middleware'
import { STORAGE_KEY } from './constants'
import { GUEST_USER_ID, getActiveUserId } from './active-user'

/** one localforage instance = one object store in the shared database */
type LocalForageInstance = ReturnType<typeof localforage.createInstance>

const DB_NAME = 'studypad'
/** object store holding the pre-multiuser pad (migrated into Guest's partition) */
const LEGACY_STORE = 'kv'

/** lazy per-user instances so importing this module never touches IndexedDB during SSR */
const userInstances = new Map<string, LocalForageInstance>()
function dbFor(userId: string): LocalForageInstance {
  let inst = userInstances.get(userId)
  if (!inst) {
    inst = localforage.createInstance({ name: DB_NAME, storeName: `u-${userId}` })
    userInstances.set(userId, inst)
  }
  return inst
}

let legacyInstance: LocalForageInstance | null = null
function legacyDb(): LocalForageInstance {
  if (!legacyInstance) {
    legacyInstance = localforage.createInstance({ name: DB_NAME, storeName: LEGACY_STORE })
  }
  return legacyInstance
}

/** the partition the storage layer should talk to right now */
function activeDb(): LocalForageInstance {
  return dbFor(getActiveUserId())
}

/**
 * Did the last persisted-state read find saved data (the user's partition
 * *or* a migrated legacy copy)? The welcome dialog uses this to tell
 * returning users apart from genuine first-time visitors — it must be
 * read only after the store has hydrated, when the answer is known.
 */
let lastReadHadData = false
export function hasStoredData(): boolean {
  return lastReadHadData
}

async function getItem(name: string): Promise<string | null> {
  const userId = getActiveUserId()
  // 1. the active user's own partition
  const current = await dbFor(userId).getItem<string>(name)
  if (current != null) {
    lastReadHadData = true
    return current
  }
  // 2. one-time migration of the pre-multiuser pad — Guest inherits it
  if (userId === GUEST_USER_ID) {
    const legacy = await legacyDb().getItem<string>(name)
    if (legacy != null) {
      await dbFor(userId).setItem(name, legacy) // copy into Guest's store first…
      await legacyDb().removeItem(name) // …drop the original only once that worked
      lastReadHadData = true
      return legacy
    }
    // 3. even older era: the pre-IndexedDB localStorage copy
    if (typeof window !== 'undefined') {
      const older = window.localStorage.getItem(name)
      if (older !== null) {
        await dbFor(userId).setItem(name, older)
        window.localStorage.removeItem(name)
        lastReadHadData = true
        return older
      }
    }
  }
  lastReadHadData = false
  return null
}

/** zustand StateStorage — promise-based, which persist supports natively */
export const idbStorage: StateStorage = {
  getItem: (name) => getItem(name),
  setItem: async (name, value) => {
    await activeDb().setItem(name, value)
  },
  removeItem: async (name) => {
    await activeDb().removeItem(name)
  },
}

/**
 * Wipe a user's whole partition (Manage Users → delete): every key in the
 * user's object store is removed and the cached localforage instance is
 * evicted, so nothing of that user survives in memory either. Best effort —
 * a storage failure must never block the removal itself.
 */
export async function clearUserPartition(userId: string): Promise<void> {
  try {
    await dbFor(userId).clear()
  } catch {
    // storage unavailable — nothing to wipe
  }
  userInstances.delete(userId)
}

/**
 * Cloud sync reads / writes a *specific* user's persisted state rather than
 * the active one — the active pointer may already have moved on to the next
 * user while a sync for the previous one is still in flight.
 */
export async function readPersistedFor(userId: string, name: string = STORAGE_KEY): Promise<string | null> {
  try {
    return (await dbFor(userId).getItem<string>(name)) ?? null
  } catch {
    return null
  }
}

export async function writePersistedFor(userId: string, value: string, name: string = STORAGE_KEY): Promise<void> {
  await dbFor(userId).setItem(name, value)
}

/** no-op storage used during SSR — reads find nothing, writes go nowhere, so
 *  the persist middleware hydrates instantly with the default state instead
 *  of erroring on an undefined storage. Methods are async on purpose: the
 *  rehydration callback then defers to a microtask, after the store has been
 *  fully initialized (a synchronous getItem would fire it mid-creation). */
const noopStorage: StateStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
}

/** factory for createJSONStorage — the server gets the no-op variant, the
 *  browser gets the per-user IndexedDB storage */
export function browserStorage(): StateStorage {
  return typeof window === 'undefined' ? noopStorage : idbStorage
}

/** read the raw persisted value directly (used by tests/tooling) */
export async function readRawPersisted(): Promise<string | null> {
  return getItem(STORAGE_KEY)
}
