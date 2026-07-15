import { useState, useMemo, useEffect } from 'react'
import { Virtuoso } from 'react-virtuoso'
import type { EmailListItem } from '@/types'
import { EmailListItemRow } from './EmailListItem'
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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    setCollapsedGroups(new Set())
  }, [folder])

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
                  >
                    <span className={`${styles.groupHeaderToggle} ${isExpanded ? styles.groupHeaderToggleExpanded : styles.groupHeaderToggleCollapsed}`}>
                      ▼
                    </span>
                    <span className={styles.groupEmail}>{item.email}</span>
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
