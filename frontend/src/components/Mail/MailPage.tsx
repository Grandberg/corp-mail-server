import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { useEmailStore } from '@/store/emailStore'
import { markEmailReadInListCache } from '@/utils/emailListPatch'
import { FolderList } from './FolderList'
import { EmailList, EmailListSelectAll } from './EmailList'
import { EmailView } from './EmailView'
import { EmailCompose, type EmailComposeHandle } from './EmailCompose'
import styles from './MailPage.module.css'

export function MailPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userEmail = useAuthStore((s) => s.user?.email)
  const { folder = 'inbox', emailId } = useParams()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const { searchQuery, composing, composeMode, replyToEmail, setComposing } =
    useEmailStore()

  const draftComposeRef = useRef<EmailComposeHandle>(null)
  const newComposeRef = useRef<EmailComposeHandle>(null)

  useEffect(() => {
    setSelectedIds(new Set())
    setIsSidebarOpen(false)
  }, [folder])

  const searchKey = searchQuery.trim() || null
  const isGlobalSearch = Boolean(searchKey)

  const foldersQuery = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.getFolders(),
  })

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  })

  const emailsQuery = useInfiniteQuery({
    queryKey: ['emails', folder, searchKey],
    queryFn: ({ pageParam }) =>
      api.getEmails({
        folder,
        page: pageParam,
        search: searchKey ?? undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  })

  const emails = useMemo(
    () => emailsQuery.data?.pages.flatMap((page) => page.emails) ?? [],
    [emailsQuery.data?.pages],
  )

  const threadQuery = useQuery({
    queryKey: ['emailThread', emailId],
    queryFn: () => api.getEmailThread(emailId!),
    enabled: Boolean(emailId) && folder !== 'drafts',
  })

  const draftQuery = useQuery({
    queryKey: ['email', emailId],
    queryFn: () => api.getEmail(emailId!),
    enabled: Boolean(emailId) && folder === 'drafts',
  })

  useEffect(() => {
    if (!emailId || folder === 'drafts') return
    if (!threadQuery.data) return
    markEmailReadInListCache(queryClient, emailId, folder)
  }, [emailId, threadQuery.data, folder, queryClient])

  async function saveOpenDrafts() {
    await draftComposeRef.current?.saveDraftSilently()
    if (composing && composeMode === 'new') {
      await newComposeRef.current?.saveDraftSilently()
    }
  }

  async function handleSelect(id: string) {
    if (id === emailId) return
    await saveOpenDrafts()
    if (composing && composeMode === 'new') {
      setComposing(false)
    }
    const email = emails.find((e) => e.id === id)
    const targetFolder = email?.folder ?? folder
    navigate(`/mail/${targetFolder}/${id}`)
  }

  async function handleComposeNew() {
    await saveOpenDrafts()
    setComposing(true, 'new', null)
  }

  function handleDraftDeleted(deletedId: string) {
    void queryClient.removeQueries({ queryKey: ['email', deletedId] })
    void queryClient.invalidateQueries({ queryKey: ['emails'] })
    void queryClient.invalidateQueries({ queryKey: ['folders'] })
    if (folder === 'drafts' && emailId === deletedId) {
      navigate('/mail/drafts')
    }
  }

  function handleSent() {
    setSelectedIds(new Set())
    void queryClient.invalidateQueries({ queryKey: ['emails'] })
    void queryClient.invalidateQueries({ queryKey: ['folders'] })
    void queryClient.invalidateQueries({ queryKey: ['emailThread', emailId] })
    void queryClient.invalidateQueries({ queryKey: ['email', emailId] })
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (emails.every((e) => selectedIds.has(e.id))) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(emails.map((e) => e.id)))
    }
  }

  async function runBulk(action: 'read' | 'unread' | 'star' | 'unstar' | 'trash') {
    if (selectedIds.size === 0) return
    await api.bulkEmailAction({ ids: [...selectedIds], action })
    setSelectedIds(new Set())
    void queryClient.invalidateQueries({ queryKey: ['emails'] })
    void queryClient.invalidateQueries({ queryKey: ['folders'] })
  }

  const selectedEmails = useMemo(
    () => emails.filter((e) => selectedIds.has(e.id)),
    [emails, selectedIds],
  )
  const hasSelection = selectedIds.size > 0
  const allSelectedRead = hasSelection && selectedEmails.every((e) => e.is_read)
  const allSelectedStarred = hasSelection && selectedEmails.every((e) => e.is_starred)

  const listLoading = emailsQuery.isLoading || emailsQuery.isFetchingNextPage
  const threadMessages = threadQuery.data ?? []
  const editingDraft = folder === 'drafts' && emailId ? draftQuery.data ?? null : null

  return (
    <div className={`${styles.mailPage} ${emailId ? styles.hasSelectedEmail : ''}`}>
      {isSidebarOpen && (
        <div
          className={styles.sidebarBackdrop}
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <aside className={`${styles.folderPanel} ${isSidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.composeBtn}
            onClick={() => void handleComposeNew()}
          >
            Написать
          </button>
          <button
            type="button"
            className={styles.contactsBtn}
            title="Контакты"
            aria-label="Контакты"
            onClick={() => void saveOpenDrafts().then(() => navigate('/contacts'))}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </button>
        </div>
        <FolderList folders={foldersQuery.data ?? []} onBeforeNavigate={() => void saveOpenDrafts()} />
      </aside>

      <section className={styles.listPanel}>
        <div className={styles.bulkBar}>
          <button
            type="button"
            className={styles.menuToggleBtn}
            onClick={() => setIsSidebarOpen(true)}
            title="Показать папки"
            aria-label="Показать папки"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <EmailListSelectAll
            emails={emails}
            selectedIds={selectedIds}
            onToggleSelectAll={toggleSelectAll}
          />
          {hasSelection && (
            <div className={styles.bulkIcons}>
              <button
                type="button"
                className={`${styles.bulkIconBtn} ${allSelectedRead ? styles.bulkIconActive : ''}`}
                title={allSelectedRead ? 'Пометить непрочитанным' : 'Пометить прочитанным'}
                aria-label={allSelectedRead ? 'Пометить непрочитанным' : 'Пометить прочитанным'}
                onClick={() => void runBulk(allSelectedRead ? 'unread' : 'read')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={allSelectedRead ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </button>
              <button
                type="button"
                className={`${styles.bulkIconBtn} ${allSelectedStarred ? styles.bulkIconStarred : ''}`}
                title={allSelectedStarred ? 'Снять пометку' : 'Пометить'}
                aria-label={allSelectedStarred ? 'Снять пометку' : 'Пометить'}
                onClick={() => void runBulk(allSelectedStarred ? 'unstar' : 'star')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={allSelectedStarred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
              <button
                type="button"
                className={`${styles.bulkIconBtn} ${styles.bulkIconDanger}`}
                title="В корзину"
                aria-label="В корзину"
                onClick={() => void runBulk('trash')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <EmailList
          emails={emails}
          selectedId={emailId ?? null}
          selectedIds={selectedIds}
          loading={listLoading}
          hasMore={emailsQuery.hasNextPage ?? false}
          showFolder={isGlobalSearch}
          emptyMessage={isGlobalSearch ? 'Ничего не найдено' : 'В этой папке нет писем'}
          onSelect={(id) => void handleSelect(id)}
          onToggleSelect={toggleSelect}
          onLoadMore={() => void emailsQuery.fetchNextPage()}
          groupByContacts={settingsQuery.data?.group_by_contacts ?? false}
          currentUserEmail={userEmail ?? ''}
          folder={folder}
        />
      </section>

      <section className={styles.viewPanel}>
        {folder === 'drafts' && emailId ? (
          draftQuery.isLoading ? (
            <div className={styles.emptyView}>Загрузка…</div>
          ) : editingDraft ? (
            <EmailCompose
              ref={draftComposeRef}
              key={emailId}
              mode="draft"
              replyTo={editingDraft}
              onClose={() => navigate('/mail/drafts')}
              onSent={handleSent}
              onAutoSaved={handleSent}
              onDraftDeleted={handleDraftDeleted}
              inline
            />
          ) : (
            <div className={styles.emptyView}>Черновик не найден</div>
          )
        ) : emailId && (threadQuery.data || threadQuery.isLoading) ? (
          <EmailView
            messages={threadMessages}
            focusId={emailId}
            loading={threadQuery.isLoading}
            userEmail={userEmail}
            onEdit={(email) => setComposing(true, 'draft', email)}
            onSent={handleSent}
          />
        ) : (
          <div className={styles.emptyView}>
            Выберите письмо из списка или нажмите «Написать»
          </div>
        )}
      </section>

      {composing && composeMode !== 'draft' && (
        <EmailCompose
          ref={newComposeRef}
          mode={composeMode}
          replyTo={replyToEmail}
          onClose={() => setComposing(false)}
          onSent={handleSent}
          onDraftDeleted={handleDraftDeleted}
          onAutoSaved={handleSent}
        />
      )}
    </div>
  )
}
