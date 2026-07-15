import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Email } from '@/types'
import { api, http } from '@/services/api'
import { displaySender, formatDate, formatSize } from '@/utils/formatDate'
import styles from './EmailView.module.css'

async function downloadAttachment(id: string, filename: string) {
  const { data } = await http.get(`/attachments/${id}`, { responseType: 'blob' })
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function messageDirection(email: Email, userEmail?: string): 'inbound' | 'outbound' {
  if (email.folder === 'sent' || email.folder === 'scheduled') return 'outbound'
  if (userEmail && email.from_address.toLowerCase() === userEmail.toLowerCase()) return 'outbound'
  return 'inbound'
}

function htmlToReplyBody(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')
  return `<p>${escaped}</p>`
}

/**
 * Резервная реконструкция заголовков для писем без сохранённого raw_source
 * (созданных до внедрения полного сырого письма). Показывает всё, что известно
 * приложению об этом сообщении.
 */
function buildRawView(email: Email): string {
  if (email.raw_source?.trim()) {
    return email.raw_source
  }

  const formatAddr = (a: { name?: string | null; email: string }) =>
    a.name ? `${a.name} <${a.email}>` : a.email

  const headers = [
    `Return-Path: <${email.from_address}>`,
    `Date: ${email.sent_at ?? email.received_at ?? email.created_at}`,
    `From: ${formatAddr({ name: email.from_name, email: email.from_address })}`,
    `To: ${email.to_addresses.map(formatAddr).join(', ') || '(нет)'}`,
    ...(email.cc_addresses.length > 0
      ? [`Cc: ${email.cc_addresses.map(formatAddr).join(', ')}`]
      : []),
    ...(email.bcc_addresses.length > 0
      ? [`Bcc: ${email.bcc_addresses.map(formatAddr).join(', ')}`]
      : []),
    `Subject: ${email.subject ?? ''}`,
    `Message-ID: ${email.message_id ?? '(нет)'}`,
    ...(email.in_reply_to ? [`In-Reply-To: ${email.in_reply_to}`] : []),
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `X-Folder: ${email.folder}`,
    ...(email.has_attachments && email.attachments.length > 0
      ? [
          `X-Attachments: ${email.attachments
            .map((a) => `${a.filename} (${Math.ceil(a.size_bytes / 1024)} KB)`)
            .join(', ')}`,
        ]
      : []),
    '',
    email.body_html ?? email.body_text ?? '',
  ]
  return headers.join('\n')
}

/** Выпадающее меню «⋮» для одного сообщения в треде. */
function MessageMenu({
  email,
  onUnschedule,
  onShowRaw,
}: {
  email: Email
  onUnschedule?: () => void
  onShowRaw: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className={styles.msgMenu} ref={ref}>
      <button
        type="button"
        className={styles.msgMenuBtn}
        aria-label="Действия с письмом"
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {open && (
        <div className={styles.msgMenuDropdown}>
          {email.folder === 'scheduled' && onUnschedule && (
            <button
              type="button"
              className={styles.msgMenuItem}
              onClick={() => { onUnschedule(); setOpen(false) }}
            >
              Отменить расписание
            </button>
          )}
          <button
            type="button"
            className={styles.msgMenuItem}
            onClick={() => { onShowRaw(); setOpen(false) }}
          >
            &lt;&gt; Показать оригинал
          </button>
        </div>
      )}
    </div>
  )
}

/** Модальное окно с исходником письма. */
function RawModal({ raw, onClose }: { raw: string; onClose: () => void }) {
  return (
    <div className={styles.rawOverlay} onClick={onClose}>
      <div className={styles.rawModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.rawHeader}>
          <span className={styles.rawTitle}>Оригинал письма</span>
          <button type="button" className={styles.rawClose} onClick={onClose}>×</button>
        </div>
        <pre className={styles.rawBody}>{raw}</pre>
      </div>
    </div>
  )
}

interface EmailViewProps {
  messages: Email[]
  focusId: string
  loading: boolean
  userEmail?: string
  onEdit: (email: Email) => void
  onSent: () => void
}

export function EmailView({
  messages,
  focusId,
  loading,
  userEmail,
  onEdit,
  onSent,
}: EmailViewProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { folder = 'inbox' } = useParams()
  const [replyBody, setReplyBody] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [rawEmail, setRawEmail] = useState<Email | null>(null)

  const focus = messages.find((m) => m.id === focusId) ?? messages[messages.length - 1]
  const isDraft = focus?.folder === 'drafts'
  const isScheduled = focus?.folder === 'scheduled'
  const threadSubject = focus?.subject || '(без темы)'

  const replyTarget =
    [...messages].reverse().find((m) => messageDirection(m, userEmail) === 'inbound') ??
    messages[messages.length - 1]

  const replyMutation = useMutation({
    mutationFn: () => api.replyEmail(replyTarget.id, htmlToReplyBody(replyBody.trim())),
    onSuccess: () => {
      setReplyBody('')
      setReplyError(null)
      void queryClient.invalidateQueries({ queryKey: ['emailThread', focusId] })
      void queryClient.invalidateQueries({ queryKey: ['emails'] })
      void queryClient.invalidateQueries({ queryKey: ['folders'] })
      onSent()
    },
    onError: () => setReplyError('Не удалось отправить ответ'),
  })

  const unscheduleMutation = useMutation({
    mutationFn: (id: string) => api.unscheduleEmail(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] })
      void queryClient.invalidateQueries({ queryKey: ['folders'] })
      void queryClient.invalidateQueries({ queryKey: ['emailThread', focusId] })
      onSent()
    },
  })

  if (loading) {
    return (
      <div className={styles.view}>
        <div className={styles.header}>Загрузка…</div>
      </div>
    )
  }

  if (!focus) {
    return null
  }

  return (
    <div className={styles.view}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => navigate(`/mail/${folder}`)}
        title="Назад к списку"
        aria-label="Назад к списку"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        <span>Назад</span>
      </button>

      {(isDraft || isScheduled) && (
        <div className={styles.toolbar}>
          {isDraft ? (
            <button type="button" className={styles.toolBtn} onClick={() => onEdit(focus)}>
              Редактировать
            </button>
          ) : (
            <button
              type="button"
              className={styles.toolBtn}
              onClick={() => unscheduleMutation.mutate(focus.id)}
              disabled={unscheduleMutation.isPending}
            >
              {unscheduleMutation.isPending ? '…' : 'Отменить расписание'}
            </button>
          )}
        </div>
      )}

      <div className={styles.header}>
        <h2 className={styles.subject}>{threadSubject}</h2>
        {isScheduled && focus.scheduled_at && (
          <div className={styles.scheduledBadge}>
            🕐 Запланировано на{' '}
            {new Date(focus.scheduled_at).toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        )}
        {messages.length > 1 && (
          <div className={styles.threadHint}>Цепочка: {messages.length} сообщений</div>
        )}
      </div>

      <div className={styles.thread}>
        {messages.map((email) => {
          const direction = messageDirection(email, userEmail)
          const recipients = email.to_addresses
            .map((a) => (a.name ? `${a.name} <${a.email}>` : a.email))
            .join(', ')

          return (
            <article
              key={email.id}
              className={`${styles.message} ${
                direction === 'inbound' ? styles.messageInbound : styles.messageOutbound
              } ${email.id === focusId ? styles.messageFocus : ''}`}
            >
              <div className={styles.messageHeader}>
                <div className={styles.messageMeta}>
                  <span className={styles.messageKind}>
                    {direction === 'inbound' ? 'Входящее' : email.folder === 'scheduled' ? 'Запланировано' : 'Исходящее'}
                  </span>
                  {' · '}
                  {displaySender(email.from_name, email.from_address)}
                  {' → '}
                  {recipients || '—'}
                  {' · '}
                  {formatDate(email.received_at ?? email.sent_at ?? email.created_at)}
                </div>
                <MessageMenu
                  email={email}
                  onShowRaw={() => setRawEmail(email)}
                  onUnschedule={
                    email.folder === 'scheduled'
                      ? () => unscheduleMutation.mutate(email.id)
                      : undefined
                  }
                />
              </div>

              {email.attachments.length > 0 && (
                <div className={styles.attachments}>
                  <div className={styles.attachList}>
                    {email.attachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        className={styles.attachLink}
                        disabled={downloadingId === att.id}
                        onClick={() => {
                          setDownloadingId(att.id)
                          void downloadAttachment(att.id, att.filename)
                            .catch(() => undefined)
                            .finally(() => setDownloadingId(null))
                        }}
                      >
                        📎 {att.filename} ({formatSize(att.size_bytes)})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.messageBody}>
                {email.folder === 'drafts' ? (
                  <div 
                    className={styles.draftBodyClickable} 
                    onClick={(e) => {
                      // Prevent link clicks inside the draft from triggering edit mode
                      if ((e.target as HTMLElement).closest('a')) return;
                      onEdit(email);
                    }}
                    title="Нажмите, чтобы редактировать черновик"
                  >
                    <div dangerouslySetInnerHTML={{ __html: email.body_html || email.body_text || '<p><i>Пустое письмо</i></p>' }} />
                    <div className={styles.draftEditHint}>Нажмите для редактирования</div>
                  </div>
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: email.body_html || email.body_text || '' }} />
                )}
              </div>
            </article>
          )
        })}
      </div>

      {!isDraft && !isScheduled && (
        <div className={styles.composer}>
          <p className={styles.composerHint}>
            Ответ на {displaySender(replyTarget.from_name, replyTarget.from_address)}
          </p>
          <textarea
            className={styles.replyTextarea}
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Напишите ответ…"
            rows={4}
          />
          <div className={styles.composerActions}>
            <button
              type="button"
              className={styles.sendBtn}
              disabled={!replyBody.trim() || replyMutation.isPending}
              onClick={() => void replyMutation.mutate()}
            >
              {replyMutation.isPending ? 'Отправка…' : 'Отправить'}
            </button>
          </div>
          {replyError && <p className={styles.replyError}>{replyError}</p>}
        </div>
      )}

      {rawEmail && (
        <RawModal raw={buildRawView(rawEmail)} onClose={() => setRawEmail(null)} />
      )}
    </div>
  )
}
