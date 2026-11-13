'use client'

/**
 * Invisible driver for Cloud save. Mounted once at the app root so the
 * profile list syncs from the user-selection gate onwards, and the open
 * user's pad syncs for as long as their workspace is showing.
 */
import { useEffect } from 'react'
import {
  initSyncSettings,
  probeAvailability,
  startPadSync,
  startRegistrySync,
  useSyncStore,
} from '@/lib/notepad/sync'
import { SyncDialog } from '@/components/notepad/sync-dialog'

export function SyncRunner({ userId }: { userId: string | null }) {
  const active = useSyncStore((s) => s.enabled)
  const epoch = useSyncStore((s) => s.epoch)

  useEffect(() => {
    initSyncSettings()
    void probeAvailability()
  }, [])

  useEffect(() => (active ? startRegistrySync() : undefined), [active, epoch])

  useEffect(() => (active && userId ? startPadSync(userId) : undefined), [active, userId, epoch])

  return <SyncDialog />
}
