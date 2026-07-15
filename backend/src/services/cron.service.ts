import { getPool } from './db.service'

const TRASH_RETENTION_DAYS = 30
const TRASH_INTERVAL_MS = 24 * 60 * 60 * 1000

export async function purgeOldTrash(): Promise<number> {
  const { rowCount } = await getPool().query(
    `DELETE FROM emails
     WHERE folder = 'trash'
       AND created_at < NOW() - INTERVAL '${TRASH_RETENTION_DAYS} days'`,
  )
  return rowCount ?? 0
}

export function startCronJobs(): void {
  const runTrash = () => {
    void purgeOldTrash()
      .then((n) => {
        if (n > 0) console.log(`[Cron] Purged ${n} emails from trash`)
      })
      .catch((err) => console.error('[Cron] Trash purge failed:', err))
  }

  setTimeout(runTrash, 60_000)
  setInterval(runTrash, TRASH_INTERVAL_MS)
  console.log('[Cron] Scheduled trash purge (daily)')
}
