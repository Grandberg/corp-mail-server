import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { useEmailStore } from '@/store/emailStore'
import type { Contact } from '@/types'
import styles from './ContactsPage.module.css'

type Filter = 'all' | 'shared' | 'personal'

export function ContactsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const setComposing = useEmailStore((s) => s.setComposing)
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

  // Selected contact for detail/edit card modal
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    email: '',
    displayName: '',
    phone: '',
    company: '',
    position: '',
    notes: '',
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
    if (
      !window.confirm(
        `ВНИМАНИЕ: Вы уверены, что хотите окончательно удалить контакт ${contact.email}?`
      )
    )
      return
    await api.deleteContact(contact.id)
    await queryClient.invalidateQueries({ queryKey: ['contacts'] })
  }

  function handleWriteTo(email: string) {
    setComposing(true, 'new', null, [{ email }])
    navigate('/mail')
  }

  function handleOpenCard(c: Contact) {
    setSelectedContact(c)
    setEditForm({
      email: c.email || '',
      displayName: c.display_name || '',
      phone: c.phone || '',
      company: c.company || '',
      position: c.position || '',
      notes: c.notes || '',
      isShared: c.is_shared,
    })
    setIsEditing(false)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!selectedContact) return
    try {
      await api.updateContact(selectedContact.id, editForm)
      setIsEditing(false)
      setSelectedContact(null)
      await queryClient.invalidateQueries({ queryKey: ['contacts'] })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления контакта')
    }
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
            <tr
              key={c.id}
              className={styles.clickableRow}
              onClick={() => handleOpenCard(c)}
            >
              <td data-label="Имя">{c.display_name || '—'}</td>
              <td data-label="Email" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={styles.emailLinkBtn}
                  onClick={() => handleWriteTo(c.email)}
                  title="Написать письмо"
                >
                  {c.email}
                </button>
              </td>
              <td data-label="Телефон">{c.phone || '—'}</td>
              <td data-label="Тип">
                {c.is_shared ? (
                  <span className={styles.badgeShared}>Общий</span>
                ) : (
                  'Личный'
                )}
              </td>
              <td onClick={(e) => e.stopPropagation()} className={styles.actionsCell}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={() => void handleDelete(c)}
                >
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

      {selectedContact && (
        <div className={styles.modalOverlay} onClick={() => setSelectedContact(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Карточка контакта</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setSelectedContact(null)}
              >
                ×
              </button>
            </div>

            {isEditing ? (
              <form onSubmit={handleSaveEdit} className={styles.modalForm}>
                <div className={styles.field}>
                  <label className={styles.label}>Email</label>
                  <input
                    type="email"
                    className={styles.modalInput}
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Имя</label>
                  <input
                    type="text"
                    className={styles.modalInput}
                    value={editForm.displayName}
                    onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Телефон</label>
                  <input
                    type="text"
                    className={styles.modalInput}
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Компания</label>
                  <input
                    type="text"
                    className={styles.modalInput}
                    value={editForm.company}
                    onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Должность</label>
                  <input
                    type="text"
                    className={styles.modalInput}
                    value={editForm.position}
                    onChange={(e) => setEditForm({ ...editForm, position: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Заметки</label>
                  <textarea
                    className={styles.modalTextarea}
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  />
                </div>

                {isAdmin && (
                  <div className={styles.fieldRow}>
                    <label>
                      <input
                        type="checkbox"
                        checked={editForm.isShared}
                        onChange={(e) => setEditForm({ ...editForm, isShared: e.target.checked })}
                      />{' '}
                      Общий контакт домена
                    </label>
                  </div>
                )}

                {error && <div className={styles.error}>{error}</div>}

                <div className={styles.modalFooter}>
                  <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => setIsEditing(false)}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            ) : (
              <div className={styles.modalContent}>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Email:</span>
                  <span className={styles.detailValue}>
                    {selectedContact.email}{' '}
                    <button
                      type="button"
                      className={styles.writeFromCardBtn}
                      onClick={() => {
                        handleWriteTo(selectedContact.email)
                        setSelectedContact(null)
                      }}
                      title="Написать письмо"
                    >
                      ✉ Написать письмо
                    </button>
                  </span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Имя:</span>
                  <span className={styles.detailValue}>{selectedContact.display_name || '—'}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Телефон:</span>
                  <span className={styles.detailValue}>{selectedContact.phone || '—'}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Компания:</span>
                  <span className={styles.detailValue}>{selectedContact.company || '—'}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Должность:</span>
                  <span className={styles.detailValue}>{selectedContact.position || '—'}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Заметки:</span>
                  <span className={styles.detailValue}>{selectedContact.notes || '—'}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Тип:</span>
                  <span className={styles.detailValue}>
                    {selectedContact.is_shared ? 'Общий (доступен всем)' : 'Личный'}
                  </span>
                </div>

                <div className={styles.modalFooter}>
                  {!selectedContact.is_shared || isAdmin ? (
                    <>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() => setIsEditing(true)}
                      >
                        Редактировать
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnDanger}`}
                        onClick={async () => {
                          if (
                            window.confirm(
                              `ВНИМАНИЕ: Вы уверены, что хотите окончательно удалить контакт ${selectedContact.email}?`
                            )
                          ) {
                            await api.deleteContact(selectedContact.id)
                            setSelectedContact(null)
                            await queryClient.invalidateQueries({ queryKey: ['contacts'] })
                          }
                        }}
                      >
                        Удалить
                      </button>
                    </>
                  ) : (
                    <p className={styles.hint}>Редактировать общие контакты могут только администраторы</p>
                  )}
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => setSelectedContact(null)}
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
