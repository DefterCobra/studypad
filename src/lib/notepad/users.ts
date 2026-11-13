'use client'

/**
 * User registry for the multi-user system.
 *
 * Users are lightweight identities (name + avatar colour) kept in
 * localStorage — the registry must be readable synchronously by the
 * user-selection gate before any IndexedDB work happens. Each user's
 * actual notes/chapters/flashcards/quizzes live in a separate IndexedDB
 * object store (see idb-storage.ts), so switching users swaps the whole
 * workspace, not just a label.
 *
 * Guest is built in and always available: a fresh installation with no
 * users created yet shows Guest on the selection screen, and all data
 * from before the multi-user system existed belongs to Guest.
 */
import { create } from 'zustand'
import { GUEST_USER_ID } from './active-user'
import { SUBJECT_COLORS } from './constants'
import { clearUserPartition } from './idb-storage'
import { clearLastOpenNote } from './last-note'

export interface PadUser {
  id: string
  name: string
  /** avatar colour (hex) */
  color: string
  createdAt: number
}

/** the always-present default user; owns pre-multiuser data */
export const GUEST_USER: PadUser = {
  id: GUEST_USER_ID,
  name: 'Guest',
  color: '#64748b', // slate — deliberately distinct from the pickable palette
  createdAt: 0,
}

const REGISTRY_KEY = 'studypad-users-v1'
const MAX_NAME = 40

/** localStorage marker for "the user who entered last" (read by the gate) */
export const LAST_USER_KEY = 'studypad-last-user-v1'

/** per-user welcome-dialog marker — deleting a user removes theirs */
export function userWelcomeKey(userId: string): string {
  return `studypad-welcomed-u-${userId}`
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** read the registry from localStorage, ignoring anything malformed */
function loadUsers(): PadUser[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const users: PadUser[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const e = entry as Record<string, unknown>
      if (typeof e.id !== 'string' || e.id === GUEST_USER_ID) continue
      if (typeof e.name !== 'string' || !e.name.trim()) continue
      users.push({
        id: e.id,
        name: e.name.trim().slice(0, MAX_NAME),
        color: typeof e.color === 'string' ? e.color : SUBJECT_COLORS[0].value,
        createdAt: typeof e.createdAt === 'number' ? e.createdAt : 0,
      })
    }
    return users
  } catch {
    return []
  }
}

/** Guest first, then created users in creation order */
export function allUsers(users: PadUser[]): PadUser[] {
  return [GUEST_USER, ...users]
}

/** pick a colour nobody uses yet (falls back to cycling the palette) */
function pickColor(users: PadUser[]): string {
  for (const c of SUBJECT_COLORS) {
    if (!users.some((u) => u.color === c.value)) return c.value
  }
  return SUBJECT_COLORS[users.length % SUBJECT_COLORS.length].value
}

interface UsersState {
  /** created users (Guest is implicit — always available) */
  users: PadUser[]
  /** user whose workspace is open (null only before the gate is answered) */
  currentUserId: string | null
  /** registry has been read from localStorage at least once */
  loaded: boolean
  init: () => void
  addUser: (name: string, color?: string) => PadUser
  renameUser: (id: string, name: string) => void
  /** removes the user, their whole IndexedDB partition and per-user markers */
  removeUser: (id: string) => void
  setCurrentUserId: (id: string | null) => void
  /** cloud sync: replace the registry wholesale with a merged list */
  replaceUsers: (users: PadUser[]) => void
}

export const useUsersStore = create<UsersState>()((set, get) => ({
  users: [],
  currentUserId: null,
  loaded: false,

  init: () => {
    if (get().loaded || typeof window === 'undefined') return
    set({ users: loadUsers(), loaded: true })
  },

  addUser: (name, color) => {
    const trimmed = name.trim().slice(0, MAX_NAME) || 'User'
    const users = get().users
    const user: PadUser = {
      id: uid(),
      name: trimmed,
      color: color ?? pickColor(users),
      createdAt: Date.now(),
    }
    try {
      window.localStorage.setItem(REGISTRY_KEY, JSON.stringify([...users, user]))
    } catch {
      // registry write failed — the in-memory entry still works this session
    }
    set({ users: [...users, user] })
    return user
  },

  renameUser: (id, name) => {
    if (id === GUEST_USER_ID) return
    const trimmed = name.trim().slice(0, MAX_NAME)
    if (!trimmed) return
    const users = get().users.map((u) => (u.id === id ? { ...u, name: trimmed } : u))
    try {
      window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(users))
    } catch {
      // registry write failed — the rename still applies this session
    }
    set({ users })
  },

  removeUser: (id) => {
    if (id === GUEST_USER_ID) return
    const users = get().users.filter((u) => u.id !== id)
    try {
      window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(users))
    } catch {
      // registry write failed — the user is still gone this session
    }
    // wipe everything the user owned on this device (best effort)
    void clearUserPartition(id)
    try {
      window.localStorage.removeItem(userWelcomeKey(id))
    } catch {
      // cosmetic only
    }
    clearLastOpenNote(id)
    try {
      if (window.localStorage.getItem(LAST_USER_KEY) === id) {
        window.localStorage.removeItem(LAST_USER_KEY)
      }
    } catch {
      // cosmetic only
    }
    set({ users, ...(get().currentUserId === id ? { currentUserId: null } : {}) })
  },

  setCurrentUserId: (id) => set({ currentUserId: id }),

  replaceUsers: (users) => {
    try {
      window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(users))
    } catch {
      // registry write failed — the in-memory list still works this session
    }
    set({ users })
  },
}))
