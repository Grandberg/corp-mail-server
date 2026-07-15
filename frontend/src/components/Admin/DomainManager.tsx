import { FormEvent, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { DnsRecordCard } from './DnsRecordCard'
import styles from './AdminPage.module.css'

export function DomainManager() {
  const queryClient = useQueryClient()
  const [newDomain, setNewDomain] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const domainsQuery = useQuery({
    queryKey: ['admin', 'domains'],
    queryFn: () => api.getAdminDomains(),
  })

  const dnsQuery = useQuery({
    queryKey: ['admin', 'dns', selectedId],
    queryFn: () => api.getDomainDnsRecords(selectedId!),
    enabled: Boolean(selectedId),
  })

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const domain = await api.createDomain(newDomain)
      setNewDomain('')
      setSelectedId(domain.id)
      await queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка добавления домена')
    }
  }

  async function handleVerify() {
    if (!selectedId) return
    setVerifying(true)
    setError(null)
    try {
      const result = await api.verifyDomain(selectedId)
      queryClient.setQueryData(['admin', 'dns', selectedId], result.records)
      await queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка проверки DNS')
    } finally {
      setVerifying(false)
    }
  }

  const selected = domainsQuery.data?.find((d) => d.id === selectedId)

  return (
    <div>
      <h2 className={styles.sectionTitle}>Домены</h2>
      <p className={styles.hint}>
        Настройте MX, SPF, DKIM, DMARC и A-запись для приёма почты на порту 25 (Haraka, фаза 5).
      </p>

      <form className={styles.formRow} onSubmit={handleAdd}>
        <input
          className={styles.input}
          placeholder="example.com"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          required
        />
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
          Добавить домен
        </button>
      </form>

      {error && <div className={styles.error}>{error}</div>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Домен</th>
            <th>Активен</th>
            <th>DNS</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(domainsQuery.data ?? []).map((d) => (
            <tr key={d.id}>
              <td data-label="Домен">{d.domain_name}</td>
              <td data-label="Активен">{d.is_active ? '✅' : '—'}</td>
              <td data-label="DNS" className={d.is_verified ? styles.badgeOk : styles.badgePending}>
                {d.is_verified ? 'Проверен' : 'Ожидание'}
              </td>
              <td>
                <button type="button" className={styles.btn} onClick={() => setSelectedId(d.id)}>
                  DNS
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && (
        <div style={{ marginTop: 24 }}>
          <h3 className={styles.sectionTitle}>DNS: {selected.domain_name}</h3>
          <div className={styles.formRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void handleVerify()}
              disabled={verifying}
            >
              {verifying ? 'Проверка…' : 'Проверить DNS'}
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() =>
                void api.generateDomainDkim(selected.id).then(() =>
                  queryClient.invalidateQueries({ queryKey: ['admin', 'dns', selected.id] }),
                )
              }
            >
              Перегенерировать DKIM
            </button>
          </div>
          {(dnsQuery.data ?? []).map((rec) => (
            <DnsRecordCard key={`${rec.type}-${rec.name}`} record={rec} />
          ))}
        </div>
      )}
    </div>
  )
}
