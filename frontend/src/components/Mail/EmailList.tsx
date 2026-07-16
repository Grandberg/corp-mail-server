import { useState, useMemo, useEffect } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { EmailListItem } from '@/types'
import { EmailListItemRow } from './EmailListItem'
import { useEmailStore } from '@/store/emailStore'
import { api } from '@/services/api'
import styles from './EmailList.module.css'

interface EmailListProps {
  emails: EmailListItem[]
  selectedId: string | null
  selectedIds: Set<string>
  loading: boolean
  hasMore: boolean
  showFolder?: boolean
  emptyMessage?: string
  onSelect: (id: string) => void
  onToggleSelect: (id: string) => void
  onLoadMore: () => void
  groupByContacts?: boolean
  currentUserEmail?: string
  folder?: string
}

type RenderItem =
  | { type: 'header'; email: string; unreadCount: number }
  | { type: 'email'; email: EmailListItem; groupEmail: string }

export function EmailList({
  emails,
  selectedId,
  selectedIds,
  loading,
  hasMore,
  showFolder = false,
  emptyMessage = 'В этой папке нет писем',
  onSelect,
  onToggleSelect,
  onLoadMore,
  groupByContacts = false,
  currentUserEmail,
  folder,
}: EmailListProps) {
  const queryClient = useQueryClient()
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const setComposing = useEmailStore((s) => s.setComposing)

  const [contextMenu, setContextMenu] = useState<{
    mouseX: number
    mouseY: number
    email: string
  } | null>(null)

  const contactsQuery = useQuery({
    queryKey: ['contacts'],
    queryFn: () => api.getContacts(),
  })

  useEffect(() => {
    setCollapsedGroups(new Set())
  }, [folder])

  const contacts = contactsQuery.data ?? []

  const isInContacts = (emailToCheck: string) => {
    return contacts.some((c) => c.email.toLowerCase() === emailToCheck.toLowerCase())
  }

  const handleContactToggle = async (emailToCheck: string) => {
    const contact = contacts.find((c) => c.email.toLowerCase() === emailToCheck.toLowerCase())
    try {
      if (contact) {
        await api.deleteContact(contact.id)
      } else {
        await api.createContact({
          email: emailToCheck,
          displayName: emailToCheck.split('@')[0],
          isShared: false,
        })
      }
      await queryClient.invalidateQueries({ queryKey: ['contacts'] })
    } catch (err) {
      alert('Ошибка при обновлении контактов')
    }
  }

  const handleDeleteThread = async (emailToCheck: string) => {
    const groupEmails = emails.filter((email) => {
      const contactEmail =
        email.from_address.toLowerCase() === currentUserEmail?.toLowerCase()
          ? email.to_addresses?.[0]?.email ?? email.from_address
          : email.from_address
      return contactEmail.toLowerCase().trim() === emailToCheck.toLowerCase().trim()
    })
    const ids = groupEmails.map((e) => e.id)
    if (ids.length === 0) return

    try {
      await api.bulkEmailAction({
        ids,
        action: folder === 'trash' ? 'delete' : 'trash',
      })
      await queryClient.invalidateQueries({ queryKey: ['emails'] })
      await queryClient.invalidateQueries({ queryKey: ['folders'] })
    } catch (err) {
      alert('Не удалось удалить цепочку писем')
    }
  }

  const renderItems = useMemo(() => {
    if (!groupByContacts || !currentUserEmail) {
      return emails.map((email) => ({ type: 'email' as const, email, groupEmail: '' }))
    }

    const getTimestamp = (e: EmailListItem) => {
      const t = e.received_at ?? e.sent_at ?? e.created_at
      return t ? new Date(t).getTime() : 0
    }

    const groupsMap = new Map<string, EmailListItem[]>()
    for (const email of emails) {
      const contactEmail =
        email.from_address.toLowerCase() === currentUserEmail.toLowerCase()
          ? email.to_addresses?.[0]?.email ?? email.from_address
          : email.from_address
      const key = contactEmail.toLowerCase().trim()
      if (!groupsMap.has(key)) {
        groupsMap.set(key, [])
      }
      groupsMap.get(key)!.push(email)
    }

    const groupsList = Array.from(groupsMap.entries()).map(([email, list]) => {
      const sortedList = [...list].sort((a, b) => getTimestamp(b) - getTimestamp(a))
      const latestTimestamp = getTimestamp(sortedList[0])
      const unreadCount = sortedList.filter((e) => !e.is_read).length
      return { email, emails: sortedList, latestTimestamp, unreadCount }
    })

    groupsList.sort((a, b) => b.latestTimestamp - a.latestTimestamp)

    const items: RenderItem[] = []
    for (const group of groupsList) {
      items.push({
        type: 'header',
        email: group.email,
        unreadCount: group.unreadCount,
      })

      if (!collapsedGroups.has(group.email)) {
        for (const email of group.emails) {
          items.push({
            type: 'email',
            email,
            groupEmail: group.email,
          })
        }
      }
    }

    return items
  }, [emails, groupByContacts, currentUserEmail, collapsedGroups])

  return (
    <div className={`${styles.panel} ${groupByContacts ? styles.groupedList : ''}`}>
      <div className={styles.list}>
        {loading && emails.length === 0 && <div className={styles.loading}>Загрузка…</div>}
        {!loading && emails.length === 0 && (
          <div className={styles.empty}>{emptyMessage}</div>
        )}
        {emails.length > 0 && (
          <Virtuoso
            style={{ height: '100%' }}
            data={renderItems}
            endReached={() => {
              if (hasMore && !loading) onLoadMore()
            }}
            itemContent={(_index, item) => {
              if (item.type === 'header') {
                const isExpanded = !collapsedGroups.has(item.email)
                const isInboxOrSent = folder === 'inbox' || folder === 'sent'
                return (
                  <div
                    className={styles.groupHeader}
                    onClick={() => {
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev)
                        if (next.has(item.email)) {
                          next.delete(item.email)
                        } else {
                          next.add(item.email)
                        }
                        return next
                      })
                    }}
                    onContextMenu={(e) => {
                      if (!isInboxOrSent) return
                      e.preventDefault()
                      setContextMenu({
                        mouseX: e.clientX,
                        mouseY: e.clientY,
                        email: item.email,
                      })
                    }}
                  >
                    <span className={`${styles.groupHeaderToggle} ${isExpanded ? styles.groupHeaderToggleExpanded : styles.groupHeaderToggleCollapsed}`}>
                      ▼
                    </span>
                    <span className={styles.groupEmail}>{item.email}</span>
                    {isInboxOrSent && (
                      <button
                        type="button"
                        className={styles.writeDraftBtn}
                        title="Написать письмо"
                        onClick={(e) => {
                          e.stopPropagation()
                          setComposing(true, 'new', null, [{ email: item.email }])
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    )}
                    {item.unreadCount > 0 && (
                      <span className={styles.groupUnreadCount}>{item.unreadCount}</span>
                    )}
                  </div>
                )
              }

              return (
                <EmailListItemRow
                  email={item.email}
                  active={selectedId === item.email.id}
                  selected={selectedIds.has(item.email.id)}
                  showFolder={showFolder}
                  onSelect={onSelect}
                  onToggleSelect={onToggleSelect}
                />
              )
            }}
          />
        )}
      </div>

      {contextMenu && (
        <div
          className={styles.contextMenuOverlay}
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu(null)
          }}
        />
      )}
      {contextMenu && (
        <div
          className={styles.contextMenu}
          style={{ top: contextMenu.mouseY, left: contextMenu.mouseX }}
          onClick={() => setContextMenu(null)}
        >
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => void handleContactToggle(contextMenu.email)}
          >
            {isInContacts(contextMenu.email) ? 'Удалить из контактов' : 'Добавить в контакты'}
          </button>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => {
              setComposing(true, 'new', null, [{ email: contextMenu.email }])
            }}
          >
            Написать письмо
          </button>
          <button
            type="button"
            className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
            onClick={() => {
              if (window.confirm(`Удалить цепочку писем с ${contextMenu.email}?`)) {
                void handleDeleteThread(contextMenu.email)
              }
            }}
          >
            Удалить цепочку писем
          </button>
        </div>
      )}
    </div>
  )
}

export function EmailListSelectAll({
  emails,
  selectedIds,
  onToggleSelectAll,
}: {
  emails: EmailListItem[]
  selectedIds: Set<string>
  onToggleSelectAll: () => void
}) {
  const allSelected = emails.length > 0 && emails.every((e) => selectedIds.has(e.id))

  return (
    <label className={styles.selectAll} title="Выбрать все">
      <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} />
    </label>
  )
}
