import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { RichTextEditor } from '@/components/Mail/RichTextEditor'
import type { EmailRule, RuleAction, RuleCondition } from '@/types'
import styles from './SettingsPage.module.css'

type Tab = 'profile' | 'signature' | 'autoreply' | 'rules' | 'telegram' | 'password'

export function SettingsPage() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('profile')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  })

  const rulesQuery = useQuery({
    queryKey: ['rules'],
    queryFn: () => api.getRules(),
    enabled: tab === 'rules',
  })

  const foldersQuery = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.getFolders(),
    enabled: tab === 'rules',
  })

  const [displayName, setDisplayName] = useState('')
  const [signatureHtml, setSignatureHtml] = useState('')
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false)
  const [autoReplySubject, setAutoReplySubject] = useState('')
  const [autoReplyBody, setAutoReplyBody] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const [telegramUsername, setTelegramUsername] = useState('')
  const [telegramPhone, setTelegramPhone] = useState('')
  const [telegramNotificationsEnabled, setTelegramNotificationsEnabled] = useState(false)
  const [groupByContacts, setGroupByContacts] = useState(false)

  const [ruleName, setRuleName] = useState('')
  const [ruleField, setRuleField] = useState<RuleCondition['field']>('from')
  const [ruleValue, setRuleValue] = useState('')
  const [ruleFolder, setRuleFolder] = useState('inbox')

  useEffect(() => {
    if (!settingsQuery.data) return
    setDisplayName(settingsQuery.data.display_name ?? '')
    setSignatureHtml(settingsQuery.data.signature_html ?? '')
    setAutoReplyEnabled(settingsQuery.data.auto_reply_enabled)
    setAutoReplySubject(settingsQuery.data.auto_reply_subject ?? '')
    setAutoReplyBody(settingsQuery.data.auto_reply_body ?? '')
    setTelegramUsername(settingsQuery.data.telegram_username ?? '')
    setTelegramPhone(settingsQuery.data.telegram_phone ?? '')
    setTelegramNotificationsEnabled(settingsQuery.data.telegram_notifications_enabled)
    setGroupByContacts(settingsQuery.data.group_by_contacts ?? false)
  }, [settingsQuery.data])


  async function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setMessage(null)
    try {
      const settings = await api.updateAvatar(file)
      if (currentUser) {
        setUser({ ...currentUser, avatar_url: settings.avatar_url })
      }
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      setMessage('Аватар обновлён')
    } catch {
      setError('Не удалось загрузить аватар (макс. 2 МБ, изображение)')
    } finally {
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    try {
      await api.updateProfile(displayName)
      await api.updateGroupByContacts(groupByContacts)
      setMessage('Профиль сохранён')
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
    } catch {
      setError('Не удалось сохранить профиль')
    }
  }

  async function saveSignature(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    try {
      await api.updateSignature(signatureHtml)
      setMessage('Подпись сохранена')
    } catch {
      setError('Не удалось сохранить подпись')
    }
  }

  async function saveAutoReply(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    try {
      await api.updateAutoReply({
        enabled: autoReplyEnabled,
        subject: autoReplySubject,
        body: autoReplyBody,
      })
      setMessage('Автоответчик сохранён')
    } catch {
      setError('Не удалось сохранить автоответчик')
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    try {
      await api.changePassword(currentPassword, newPassword)
      setMessage('Пароль изменён')
      setCurrentPassword('')
      setNewPassword('')
    } catch {
      setError('Неверный текущий пароль или ошибка сохранения')
    }
  }

  async function saveTelegramSettings(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    try {
      await api.updateTelegramSettings({
        username: telegramUsername || null,
        phone: telegramPhone || null,
        enabled: telegramNotificationsEnabled,
      })
      setMessage('Настройки Telegram сохранены')
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
    } catch {
      setError('Не удалось сохранить настройки Telegram')
    }
  }

  async function testTelegram() {
    setError(null)
    setMessage(null)
    try {
      await api.testTelegramNotification()
      setMessage('Тестовое уведомление отправлено в Telegram')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Не удалось отправить тестовое уведомление')
    }
  }


  async function addRule(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const conditions: RuleCondition[] = [
        { field: ruleField, operator: 'contains', value: ruleValue },
      ]
      const actions: RuleAction[] = [{ type: 'move', params: { folder: ruleFolder } }]
      await api.createRule({ name: ruleName, conditions, actions })
      setRuleName('')
      setRuleValue('')
      await queryClient.invalidateQueries({ queryKey: ['rules'] })
      setMessage('Правило добавлено')
    } catch {
      setError('Не удалось создать правило')
    }
  }

  async function deleteRule(rule: EmailRule) {
    await api.deleteRule(rule.id)
    await queryClient.invalidateQueries({ queryKey: ['rules'] })
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Настройки</h1>

      <div className={styles.tabs}>
        {(
          [
            ['profile', 'Профиль'],
            ['signature', 'Подпись'],
            ['autoreply', 'Автоответчик'],
            ['rules', 'Фильтры'],
            ['telegram', 'Telegram'],
            ['password', 'Пароль'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {message && <div className={styles.success}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {tab === 'profile' && (
        <form className={styles.panel} onSubmit={saveProfile}>
          <div className={styles.avatarRow}>
            {settingsQuery.data?.avatar_url ? (
              <img
                className={styles.avatar}
                src={settingsQuery.data.avatar_url}
                alt="Аватар"
              />
            ) : (
              <div className={styles.avatarPlaceholder}>
                {(settingsQuery.data?.display_name || settingsQuery.data?.email || '?')
                  .charAt(0)
                  .toUpperCase()}
              </div>
            )}
            <div className={styles.avatarActions}>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={handleAvatarChange}
              />
              <button
                type="button"
                className={styles.btn}
                onClick={() => avatarInputRef.current?.click()}
              >
                Загрузить аватар
              </button>
              <span className={styles.avatarHint}>PNG, JPEG, GIF или WEBP, до 2 МБ</span>
            </div>
          </div>
          <label>
            Email
            <input className={styles.input} value={settingsQuery.data?.email ?? ''} disabled />
          </label>
          <label>
            Отображаемое имя
            <input
              className={styles.input}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className={styles.checkboxRow} style={{ marginTop: '8px', marginBottom: '16px' }}>
            <input
              type="checkbox"
              checked={groupByContacts}
              onChange={(e) => setGroupByContacts(e.target.checked)}
            />
            Группировать по отправителям и получателям
          </label>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            Сохранить
          </button>
        </form>
      )}

      {tab === 'signature' && (
        <form className={styles.panel} onSubmit={saveSignature}>
          <p>Подпись добавляется к исходящим письмам автоматически.</p>
          <RichTextEditor value={signatureHtml} onChange={setSignatureHtml} />
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            Сохранить подпись
          </button>
        </form>
      )}

      {tab === 'autoreply' && (
        <form className={styles.panel} onSubmit={saveAutoReply}>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={autoReplyEnabled}
              onChange={(e) => setAutoReplyEnabled(e.target.checked)}
            />
            Включить автоответчик
          </label>
          <input
            className={styles.input}
            placeholder="Тема (по умолчанию Auto: Re: ...)"
            value={autoReplySubject}
            onChange={(e) => setAutoReplySubject(e.target.value)}
          />
          <RichTextEditor value={autoReplyBody} onChange={setAutoReplyBody} />
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            Сохранить
          </button>
        </form>
      )}

      {tab === 'rules' && (
        <div className={styles.panel}>
          <form onSubmit={addRule}>
            <input
              className={styles.input}
              placeholder="Название правила"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              required
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <select
                className={styles.input}
                value={ruleField}
                onChange={(e) => setRuleField(e.target.value as RuleCondition['field'])}
              >
                <option value="from">Отправитель</option>
                <option value="subject">Тема</option>
                <option value="to">Получатель</option>
              </select>
              <input
                className={styles.input}
                placeholder="Содержит..."
                value={ruleValue}
                onChange={(e) => setRuleValue(e.target.value)}
                required
              />
              <select
                className={styles.input}
                value={ruleFolder}
                onChange={(e) => setRuleFolder(e.target.value)}
              >
                {(foldersQuery.data ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    → {f.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} style={{ marginTop: 8 }}>
              Добавить правило
            </button>
          </form>

          {(rulesQuery.data ?? []).map((rule) => (
            <div key={rule.id} className={styles.ruleCard}>
              <strong>{rule.name}</strong>
              <div>
                {rule.conditions.map((c, i) => (
                  <span key={i}>
                    {c.field} {c.operator} «{c.value}»{' '}
                  </span>
                ))}
              </div>
              <button type="button" className={styles.btn} onClick={() => void deleteRule(rule)}>
                Удалить
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'telegram' && (
        <form className={styles.panel} onSubmit={saveTelegramSettings}>
          <p style={{ color: '#64748b', marginBottom: 16 }}>
            Вы можете настроить получение уведомлений о новых письмах в Telegram от имени системного бота.
          </p>

          <label>
            Telegram Username (имя пользователя без @)
            <input
              className={styles.input}
              placeholder="my_telegram_username"
              value={telegramUsername}
              onChange={(e) => setTelegramUsername(e.target.value)}
            />
          </label>

          <label style={{ marginTop: 12, display: 'block' }}>
            Номер телефона (необязательно)
            <input
              className={styles.input}
              placeholder="+79991234567"
              value={telegramPhone}
              onChange={(e) => setTelegramPhone(e.target.value)}
            />
          </label>

          <label className={styles.checkboxRow} style={{ marginTop: 16 }}>
            <input
              type="checkbox"
              checked={telegramNotificationsEnabled}
              onChange={(e) => setTelegramNotificationsEnabled(e.target.checked)}
            />
            Включить уведомления о новых письмах
          </label>

          <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
              Сохранить
            </button>
            {settingsQuery.data?.telegram_chat_id && (
              <button
                type="button"
                className={styles.btn}
                onClick={testTelegram}
              >
                Проверить отправку
              </button>
            )}
          </div>

          <div style={{ marginTop: 24, padding: 16, backgroundColor: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Статус подключения бота:</strong>
            {settingsQuery.data?.telegram_chat_id ? (
              <div style={{ color: '#16a34a', fontWeight: 500 }}>
                ● Подключено (Чат ID: {settingsQuery.data.telegram_chat_id})
              </div>
            ) : (
              <div>
                <span style={{ color: '#d97706', fontWeight: 500 }}>● Не подключено</span>
                <p style={{ fontSize: '0.9em', color: '#64748b', marginTop: 8, lineHeight: '1.5em' }}>
                  Для активации уведомлений:
                  <ol style={{ paddingLeft: 18, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <li>Введите имя пользователя Telegram выше и сохраните.</li>
                    <li>
                      {settingsQuery.data?.telegram_bot_username ? (
                        <div>
                          Откройте диалог с ботом{' '}
                          <a
                            href={`https://t.me/${settingsQuery.data.telegram_bot_username}?start=${currentUser?.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#2563eb', textDecoration: 'underline', fontWeight: 500 }}
                          >
                            @{settingsQuery.data.telegram_bot_username}
                          </a>{' '}
                          и нажмите кнопку <b>Запустить / Start</b>.
                          
                          <div style={{ marginTop: 8, color: '#64748b', fontSize: '0.95em' }}>
                            Если ссылка не работает или перенаправляет в «Избранное», найдите бота вручную в Telegram по имени <b>@{settingsQuery.data.telegram_bot_username}</b> и отправьте ему этот текст:
                            
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                              <code style={{ padding: '6px 10px', backgroundColor: '#f1f5f9', borderRadius: 4, fontFamily: 'monospace', fontSize: '1em', color: '#0f172a', border: '1px solid #cbd5e1' }}>
                                /start {currentUser?.id}
                              </code>
                              <button
                                type="button"
                                className={styles.btn}
                                style={{ padding: '4px 10px', fontSize: '0.9em' }}
                                onClick={() => {
                                  if (currentUser?.id) {
                                    navigator.clipboard.writeText(`/start ${currentUser.id}`)
                                    alert('Команда скопирована в буфер обмена!')
                                  }
                                }}
                              >
                                Копировать
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        'Администратор еще не настроил системного Telegram бота. Обратитесь к админу.'
                      )}
                    </li>
                  </ol>
                </p>
              </div>
            )}
          </div>
        </form>
      )}

      {tab === 'password' && (
        <form className={styles.panel} onSubmit={savePassword}>
          <input
            className={styles.input}
            type="password"
            placeholder="Текущий пароль"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <input
            className={styles.input}
            type="password"
            placeholder="Новый пароль (мин. 8 символов)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            Сменить пароль
          </button>
        </form>
      )}
    </div>
  )
}
