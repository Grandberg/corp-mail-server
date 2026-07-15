import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { connectMailEvents } from '@/services/mailEvents'
import { useAuthStore } from '@/store/authStore'

const INITIAL_RETRY_MS = 2_000
const MAX_RETRY_MS = 30_000

function invalidateMailQueries(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ['emails'] })
  void qc.invalidateQueries({ queryKey: ['folders'] })
  void qc.invalidateQueries({ queryKey: ['email'] })
}

/**
 * SSE-подписка на обновления почтового ящика.
 * По событию mail_updated — invalidate React Query (как correspondence_updated в MAPS_info).
 */
export function useMailEvents(enabled: boolean): void {
  const qc = useQueryClient()
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (!enabled) return

    const abort = new AbortController()
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryMs = INITIAL_RETRY_MS

    const scheduleReconnect = () => {
      if (abort.signal.aborted) return
      retryTimer = setTimeout(() => {
        void run()
      }, retryMs)
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
    }

    const run = async () => {
      try {
        await connectMailEvents((event) => {
          if (event === 'mail_updated') {
            retryMs = INITIAL_RETRY_MS
            invalidateMailQueries(qc)
          }
        }, abort.signal)
        scheduleReconnect()
      } catch {
        scheduleReconnect()
      }
    }

    void run()

    return () => {
      abort.abort()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [enabled, qc, token])
}
