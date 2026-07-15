import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { EmailListItem, EmailsPage, Folder } from '@/types'

function patchEmailsPage(
  page: EmailsPage,
  emailId: string,
  patch: Partial<EmailListItem>,
): EmailsPage {
  return {
    ...page,
    emails: page.emails.map((e) => (e.id === emailId ? { ...e, ...patch } : e)),
  }
}

function wasEmailUnreadInCache(qc: QueryClient, emailId: string): boolean {
  const queries = qc.getQueriesData<InfiniteData<EmailsPage>>({ queryKey: ['emails'] })
  for (const [, data] of queries) {
    if (!data) continue
    for (const page of data.pages) {
      const item = page.emails.find((e) => e.id === emailId)
      if (item && !item.is_read) return true
    }
  }
  return false
}

/** Пометить письмо прочитанным в кэше списка и счётчиках папок. */
export function markEmailReadInListCache(
  qc: QueryClient,
  emailId: string,
  folder: string,
): void {
  const wasUnread = wasEmailUnreadInCache(qc, emailId)

  qc.setQueriesData<InfiniteData<EmailsPage>>({ queryKey: ['emails'] }, (old) => {
    if (!old) return old
    return {
      ...old,
      pages: old.pages.map((page) => patchEmailsPage(page, emailId, { is_read: true })),
    }
  })

  if (wasUnread) {
    qc.setQueryData<Folder[]>(['folders'], (old) => {
      if (!old) return old
      return old.map((f) => {
        if (f.id !== folder || f.unread_count <= 0) return f
        return { ...f, unread_count: f.unread_count - 1 }
      })
    })
  }
}
