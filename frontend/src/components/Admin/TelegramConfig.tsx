import { FormEvent, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import styles from './AdminPage.module.css'

export function TelegramConfig() {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const configQuery = useQuery({
    queryKey: ['admin', 'telegram-config'],
    queryFn: () => api.getTelegramConfig(),
  })

  const statusQuery = useQuery({
    queryKey: ['admin', 'telegram-status'],
    queryFn: () => api.getTelegramBotStatus(),
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (configQuery.data) {
      setToken(configQuery.data.token || '')
      setUsername(configQuery.data.username || '')
    }
  }, [configQuery.data])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!token.trim() || !username.trim()) {
      setError('Токен и имя пользователя бота обязательны')
      return
    }

    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    try {
      await api.applyTelegramConfig(token.trim(), username.trim())
      setMessage('Настройки Telegram-бота сохранены. Бот успешно запущен/перезапущен.')
      await queryClient.invalidateQueries({ queryKey: ['admin', 'telegram-config'] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'telegram-status'] })
    } catch (err: any) {
      setError(err.response?.data?.error || 'Не удалось сохранить настройки Telegram-бота')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (configQuery.isLoading) {
    return <p>Загрузка конфигурации Telegram...</p>
  }

  return (
    <div>
      <h2 className={styles.sectionTitle}>Настройка Telegram-бота</h2>
      <p style={{ color: '#64748b', marginBottom: 20 }}>
        Укажите токен и имя пользователя Telegram-бота, от имени которого будут рассылаться
        уведомления о новых письмах для всех почтовых ящиков. Бот создается в Telegram через @BotFather.
      </p>

      {message && <div className={styles.success} style={{ marginBottom: 16, padding: 12, backgroundColor: '#dcfce7', color: '#166534', borderRadius: 6 }}>{message}</div>}
      {error && <div className={styles.error} style={{ marginBottom: 16, padding: 12, backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: 6 }}>{error}</div>}

      <form onSubmit={handleSave} className={styles.form} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          Токен Telegram-бота (Bot Token)
          <input
            className={styles.input}
            type="password"
            placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={isSubmitting}
            required
            style={{ width: '100%' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          Username бота (без @)
          <input
            className={styles.input}
            type="text"
            placeholder="my_company_mail_bot"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isSubmitting}
            required
            style={{ width: '100%' }}
          />
        </label>

        <div>
          <button
            type="submit"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={isSubmitting}
            style={{ marginTop: 8 }}
          >
            {isSubmitting ? 'Сохранение...' : 'Сохранить настройки'}
          </button>
        </div>
      </form>

      {statusQuery.data && (
        <div style={{ marginTop: 24, padding: 16, backgroundColor: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', maxWidth: 600 }}>
          <h4 style={{ margin: '0 0 12px 0' }}>Текущий статус Telegram-бота:</h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.95em' }}>
            <div>
              <strong>Активность: </strong>
              {statusQuery.data.isPolling ? (
                <span style={{ color: '#16a34a', fontWeight: 'bold' }}>● Работает (активен поллинг)</span>
              ) : (
                <span style={{ color: '#dc2626', fontWeight: 'bold' }}>● Остановлен (токен не настроен или ошибка авторизации)</span>
              )}
            </div>

            {statusQuery.data.botUsername && (
              <div>
                <strong>Имя бота: </strong>
                <a
                  href={`https://t.me/${statusQuery.data.botUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb', textDecoration: 'underline' }}
                >
                  @{statusQuery.data.botUsername}
                </a>
              </div>
            )}

            {statusQuery.data.lastPollSuccessAt && (
              <div>
                <strong>Последнее успешное соединение: </strong>
                {new Date(statusQuery.data.lastPollSuccessAt).toLocaleString()}
              </div>
            )}

            {statusQuery.data.lastPollError ? (
              <div style={{ padding: 10, backgroundColor: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 6, color: '#991b1b', marginTop: 4 }}>
                <strong>Ошибка соединения/поллинга: </strong>
                <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{statusQuery.data.lastPollError}</span>
              </div>
            ) : statusQuery.data.isPolling && (
              <div style={{ color: '#16a34a' }}>
                ✓ Соединение с Telegram API установлено успешно.
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, padding: 16, backgroundColor: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', maxWidth: 600 }}>
        <h4 style={{ margin: '0 0 8px 0' }}>Инструкция по настройке:</h4>
        <ol style={{ paddingLeft: 20, margin: 0, fontSize: '0.95em', color: '#475569', lineHeight: '1.6em' }}>
          <li>Откройте Telegram, найдите бота <b>@BotFather</b> и отправьте команду <code>/newbot</code>.</li>
          <li>Следуйте инструкциям: введите имя бота и его username (должен оканчиваться на <code>bot</code>).</li>
          <li>Скопируйте полученный API Token (например, <code>123456789:ABC...</code>) и вставьте в поле выше.</li>
          <li>Укажите username бота в поле выше (без знака @) и нажмите кнопку "Сохранить настройки".</li>
        </ol>
      </div>
    </div>
  )
}
