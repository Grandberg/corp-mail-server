import { FormEvent, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import styles from './AdminPage.module.css'

export function AliasManager() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)
  const isSuperadmin = currentUser?.role === 'superadmin'

  const domainsQuery = useQuery({
    queryKey: ['admin', 'domains'],
    queryFn: () => api.getAdminDomains(),
  })

  const [domainId, setDomainId] = useState(currentUser?.domain_id ?? '')
  const [sourceAddress, setSourceAddress] = useState('')
  const [destinationUserId, setDestinationUserId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const effectiveDomainId = isSuperadmin ? domainId : (currentUser?.domain_id ?? '')

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', effectiveDomainId],
    queryFn: () => api.getAdminUsers(effectiveDomainId),
    enabled: Boolean(effectiveDomainId),
  })

  const aliasesQuery = useQuery({
    queryKey: ['admin', 'aliases', effectiveDomainId],
    queryFn: () => api.getAdminAliases(effectiveDomainId),
    enabled: Boolean(effectiveDomainId),
  })

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!effectiveDomainId) return
    setError(null)
    try {
      await api.createAlias({
        sourceAddress,
        destinationUserId,
        domainId: effectiveDomainId,
      })
      setSourceAddress('')
      await queryClient.invalidateQueries({ queryKey: ['admin', 'aliases'] })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка создания алиаса')
    }
  }

  return (
    <div>
      <h2 className={styles.sectionTitle}>Алиасы</h2>
      <p className={styles.hint}>Письма на alias@domain доставляются указанному пользователю.</p>

      {isSuperadmin && (
        <select
          className={styles.input}
          value={domainId}
          onChange={(e) => setDomainId(e.target.value)}
          style={{ marginBottom: 12 }}
        >
          <option value="">Выберите домен</option>
          {(domainsQuery.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.domain_name}</option>
          ))}
        </select>
      )}

      <form onSubmit={handleCreate}>
        <div className={styles.formRow}>
          <input
            className={styles.input}
            placeholder="alias@domain.com"
            value={sourceAddress}
            onChange={(e) => setSourceAddress(e.target.value)}
            required
          />
          <select
            className={styles.input}
            value={destinationUserId}
            onChange={(e) => setDestinationUserId(e.target.value)}
            required
          >
            <option value="">Получатель</option>
            {(usersQuery.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.email}</option>
            ))}
          </select>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>Добавить</button>
        </div>
      </form>

      {error && <div className={styles.error}>{error}</div>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Алиас</th>
            <th>→ Пользователь</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(aliasesQuery.data ?? []).map((a) => (
            <tr key={a.id}>
              <td data-label="Алиас">{a.source_address}</td>
              <td data-label="Пользователь">{a.destination_email}</td>
              <td>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={() =>
                    void api.deleteAlias(a.id).then(() =>
                      queryClient.invalidateQueries({ queryKey: ['admin', 'aliases'] }),
                    )
                  }
                >
                  Удалить
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
