import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import { formatSize } from '@/utils/formatDate'
import styles from './AdminPage.module.css'

export function SystemStats() {
  const statsQuery = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.getAdminStats(),
  })

  const mailConfigQuery = useQuery({
    queryKey: ['admin', 'mail-config'],
    queryFn: () => api.getServerMailConfig(),
  })

  const queueQuery = useQuery({
    queryKey: ['admin', 'queue'],
    queryFn: () => api.getMailQueue(),
  })

  const queue = queueQuery.data

  const stats = statsQuery.data
  const mailConfig = mailConfigQuery.data
  const ipIsLocal =
    mailConfig?.server_public_ip === '127.0.0.1' || mailConfig?.server_public_ip === '0.0.0.0'

  return (
    <div>
      <h2 className={styles.sectionTitle}>Система</h2>

      {mailConfig && (
        <div className={styles.card} style={{ marginBottom: 16 }}>
          <strong>DNS / MTA</strong>
          <div className={styles.mono} style={{ marginTop: 8 }}>
            SERVER_PUBLIC_IP = {mailConfig.server_public_ip}
            {mailConfig.mail_hostname ? ` · MAIL_HOSTNAME = ${mailConfig.mail_hostname}` : ''}
            {` · MTA_ENABLED = ${mailConfig.mta_enabled ? 'true' : 'false'}`}
          </div>
          {ipIsLocal && (
            <p className={styles.error} style={{ marginTop: 8 }}>
              Указан localhost — DNS A/SPF записи будут неверными. Задайте{' '}
              <code>SERVER_PUBLIC_IP</code> в стеке Portainer или файл{' '}
              <code>/opt/email/secret/server_public_ip</code> и перезапустите backend.
            </p>
          )}
        </div>
      )}

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats?.total_users ?? '—'}</div>
          <div className={styles.statLabel}>Пользователей</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats?.total_domains ?? '—'}</div>
          <div className={styles.statLabel}>Доменов</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats?.verified_domains ?? '—'}</div>
          <div className={styles.statLabel}>DNS проверено</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats?.total_emails ?? '—'}</div>
          <div className={styles.statLabel}>Писем в БД</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>
            {stats ? formatSize(stats.storage_used_bytes) : '—'}
          </div>
          <div className={styles.statLabel}>Объём писем</div>
        </div>
      </div>

      <p className={styles.hint} style={{ marginTop: 16 }}>
        MTA: {queue?.mta_enabled ? (queue.mta_connected ? '✅ Haraka подключён' : '⚠ Haraka недоступен') : '— отключён'}
        {queue?.message ? ` · ${queue.message}` : ''}
      </p>
    </div>
  )
}
