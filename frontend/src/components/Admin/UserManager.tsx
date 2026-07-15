import { FormEvent, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { formatSize } from '@/utils/formatDate'
import type { UserRole } from '@/types'
import styles from './AdminPage.module.css'

function extractApiError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const data = (err as { response?: { data?: { error?: string } } }).response?.data
    if (data?.error) return data.error
  }
  return err instanceof Error ? err.message : 'Ошибка создания пользователя'
}

export function UserManager() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)
  const isSuperadmin = currentUser?.role === 'superadmin'

  const domainsQuery = useQuery({
    queryKey: ['admin', 'domains'],
    queryFn: () => api.getAdminDomains(),
    enabled: isSuperadmin,
  })

  const [domainId, setDomainId] = useState(isSuperadmin ? '' : (currentUser?.domain_id ?? ''))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [error, setError] = useState<string | null>(null)

  const effectiveDomainId = isSuperadmin ? domainId : (currentUser?.domain_id ?? '')

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', effectiveDomainId],
    queryFn: () => api.getAdminUsers(effectiveDomainId || undefined),
    enabled: Boolean(effectiveDomainId) || isSuperadmin,
  })

  function handleEmailChange(value: string) {
    setEmail(value)
    if (!isSuperadmin) return
    const emailDomain = value.split('@')[1]?.trim().toLowerCase()
    if (!emailDomain) return
    const match = (domainsQuery.data ?? []).find((d) => d.domain_name.toLowerCase() === emailDomain)
    if (match) setDomainId(match.id)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!effectiveDomainId) {
      setError('Выберите домен')
      return
    }
    setError(null)
    try {
      await api.createAdminUser({
        email,
        password,
        displayName: displayName || undefined,
        role,
        domainId: effectiveDomainId,
      })
      setEmail('')
      setPassword('')
      setDisplayName('')
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    } catch (err: unknown) {
      setError(extractApiError(err))
    }
  }

  return (
    <div>
      <h2 className={styles.sectionTitle}>Пользователи</h2>

      {isSuperadmin && (
        <div className={styles.formRow}>
          <select
            className={styles.input}
            value={domainId}
            onChange={(e) => setDomainId(e.target.value)}
          >
            <option value="">Все домены</option>
            {(domainsQuery.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.domain_name}</option>
            ))}
          </select>
        </div>
      )}

      <form onSubmit={handleCreate}>
        <div className={styles.formRow}>
          <input
            className={styles.input}
            placeholder="email@domain.com"
            value={email}
            onChange={(e) => handleEmailChange(e.target.value)}
            required
          />
          <input className={styles.input} type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          <input className={styles.input} placeholder="Имя" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <select className={styles.input} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
            {isSuperadmin && <option value="superadmin">superadmin</option>}
          </select>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>Создать</button>
        </div>
      </form>

      {error && <div className={styles.error}>{error}</div>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Email</th>
            <th>Роль</th>
            <th>Ящик</th>
            <th>Статус</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(usersQuery.data ?? []).map((u) => (
            <tr key={u.id}>
              <td data-label="Email">{u.email}</td>
              <td data-label="Роль">{u.role}</td>
              <td data-label="Ящик" className={styles.mailboxStats} title="непрочитанные / всего писем / размер">
                {u.unread_count} / {u.total_emails} / {formatSize(u.mailbox_size_bytes)}
              </td>
              <td data-label="Статус">{u.is_active ? 'Активен' : 'Отключён'}</td>
              <td>
                {u.id !== currentUser?.id && (
                  <>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() =>
                        void api
                          .updateAdminUser(u.id, { isActive: !u.is_active })
                          .then(() => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }))
                      }
                    >
                      {u.is_active ? 'Деактивировать' : 'Активировать'}
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnDanger}`}
                      onClick={() =>
                        void api.deleteAdminUser(u.id).then(() =>
                          queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
                        )
                      }
                    >
                      Удалить
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
