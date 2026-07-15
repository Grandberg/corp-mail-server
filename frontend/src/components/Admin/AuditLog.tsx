import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import { formatDate } from '@/utils/formatDate'
import styles from './AdminPage.module.css'

export function AuditLog() {
  const auditQuery = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.getAuditLog(1),
  })

  return (
    <div>
      <h2 className={styles.sectionTitle}>Журнал аудита</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Время</th>
            <th>Пользователь</th>
            <th>Действие</th>
            <th>Объект</th>
          </tr>
        </thead>
        <tbody>
          {(auditQuery.data?.items ?? []).map((entry) => (
            <tr key={entry.id}>
              <td data-label="Время">{formatDate(entry.created_at)}</td>
              <td data-label="Пользователь">{entry.user_email ?? '—'}</td>
              <td data-label="Действие">{entry.action}</td>
              <td data-label="Объект">{entry.target_type ?? '—'} {entry.target_id?.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
