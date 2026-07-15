import { FormEvent, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import styles from './AdminPage.module.css'

export function DbConfig() {
  const queryClient = useQueryClient()
  const dbQuery = useQuery({
    queryKey: ['admin', 'db-config'],
    queryFn: () => api.getDbConfig(),
  })

  const [connectionString, setConnectionString] = useState('')
  const [testResult, setTestResult] = useState<boolean | null>(null)
  const [applyMessage, setApplyMessage] = useState<string | null>(null)

  async function handleTest(e: FormEvent) {
    e.preventDefault()
    const ok = await api.testDbConnection(connectionString)
    setTestResult(ok)
    setApplyMessage(null)
  }

  async function handleApply() {
    const result = await api.applyDbConfig(connectionString)
    setApplyMessage(result.message)
    await queryClient.invalidateQueries({ queryKey: ['admin', 'db-config'] })
  }

  const db = dbQuery.data

  return (
    <div>
      <h2 className={styles.sectionTitle}>Подключение БД</h2>
      <p className={styles.hint}>
        Текущий режим: <strong>{db?.mode}</strong> · Подключение: {db?.connected ? '✅' : '❌'}
      </p>
      {db && (
        <div className={styles.mono} style={{ marginBottom: 16 }}>
          {db.host}:{db.port} / {db.database} (user: {db.user})
        </div>
      )}

      <form onSubmit={handleTest}>
        <div className={styles.formRow}>
          <input
            className={styles.input}
            placeholder="postgresql://user:pass@host:5432/db"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
          />
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            Проверить
          </button>
          <button
            type="button"
            className={styles.btn}
            disabled={!connectionString.trim()}
            onClick={() => void handleApply()}
          >
            Применить
          </button>
        </div>
      </form>

      {testResult !== null && (
        <p className={testResult ? styles.badgeOk : styles.badgeFail}>
          {testResult ? 'Подключение успешно' : 'Не удалось подключиться'}
        </p>
      )}

      {applyMessage && <p className={styles.hint}>{applyMessage}</p>}
    </div>
  )
}
