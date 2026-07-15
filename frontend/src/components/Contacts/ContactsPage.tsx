import { FormEvent, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import type { Contact } from '@/types'
import styles from './ContactsPage.module.css'

type Filter = 'all' | 'shared' | 'personal'

export function ContactsPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    email: '',
    displayName: '',
    phone: '',
    company: '',
    isShared: false,
  })

  const contactsQuery = useQuery({
    queryKey: ['contacts'],
    queryFn: () => api.getContacts(),
  })

  const groupsQuery = useQuery({
    queryKey: ['contact-groups'],
    queryFn: () => api.getContactGroups(),
  })

  const contacts = (contactsQuery.data ?? []).filter((c) => {
    if (filter === 'shared') return c.is_shared
    if (filter === 'personal') return !c.is_shared
    return true
  })

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.createContact(form)
      setForm({ email: '', displayName: '', phone: '', company: '', isShared: false })
      await queryClient.invalidateQueries({ queryKey: ['contacts'] })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения')
    }
  }

  async function handleDelete(contact: Contact) {
    if (!window.confirm(`Удалить контакт ${contact.email}?`)) return
    await api.deleteContact(contact.id)
    await queryClient.invalidateQueries({ queryKey: ['contacts'] })
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Контакты</h1>
      <p className={styles.hint}>
        Общие контакты видны всем пользователям домена. Личные — только вам.
      </p>

      <div className={styles.tabs}>
        {(['all', 'shared', 'personal'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`${styles.tab} ${filter === tab ? styles.tabActive : ''}`}
            onClick={() => setFilter(tab)}
          >
            {tab === 'all' ? 'Все' : tab === 'shared' ? 'Общие' : 'Личные'}
          </button>
        ))}
      </div>

      <form className={styles.form} onSubmit={handleAdd}>
        <div className={styles.formRow}>
          <input
            className={styles.input}
            placeholder="email@example.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            type="email"
          />
          <input
            className={styles.input}
            placeholder="Имя"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <input
            className={styles.input}
            placeholder="Телефон"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            className={styles.input}
            placeholder="Компания"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
        </div>
        <div className={styles.formRow}>
          {isAdmin && (
            <label>
              <input
                type="checkbox"
                checked={form.isShared}
                onChange={(e) => setForm({ ...form, isShared: e.target.checked })}
              />{' '}
              Общий контакт домена
            </label>
          )}
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            Добавить
          </button>
        </div>
        {error && <div className={styles.error}>{error}</div>}
      </form>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Имя</th>
            <th>Email</th>
            <th>Телефон</th>
            <th>Тип</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id}>
              <td data-label="Имя">{c.display_name || '—'}</td>
              <td data-label="Email">{c.email}</td>
              <td data-label="Телефон">{c.phone || '—'}</td>
              <td data-label="Тип">
                {c.is_shared ? (
                  <span className={styles.badgeShared}>Общий</span>
                ) : (
                  'Личный'
                )}
              </td>
              <td>
                <button type="button" className={styles.btn} onClick={() => void handleDelete(c)}>
                  Удалить
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(groupsQuery.data ?? []).length > 0 && (
        <div>
          <h2>Группы</h2>
          <ul>
            {(groupsQuery.data ?? []).map((g) => (
              <li key={g.id}>
                {g.name} ({g.contact_count}) {g.is_shared ? '— общая' : '— личная'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
