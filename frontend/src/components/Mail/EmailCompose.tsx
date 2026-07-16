import {
  FormEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { Attachment, ComposeMode, Email, EmailAddress } from '@/types'
import { api, http } from '@/services/api'
import { RichTextEditor } from './RichTextEditor'
import { RecipientInput, type RecipientInputHandle } from './RecipientInput'
import { formatSize } from '@/utils/formatDate'
import { isBlockedExecutableFile } from '@/utils/blockedFile'
import styles from './EmailCompose.module.css'

function isDraftEmpty(
  to: EmailAddress[],
  cc: EmailAddress[],
  bcc: EmailAddress[],
  subject: string,
  bodyHtml: string,
  attachments: Attachment[],
  signatureHtml?: string | null
): boolean {
  if (to.length > 0 || cc.length > 0 || bcc.length > 0) return false
  if (subject.trim() !== '') return false
  if (attachments.length > 0) return false

  const cleanText = (html: string) =>
    html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const text = cleanText(bodyHtml)
  if (!text) return true

  if (signatureHtml) {
    const sigText = cleanText(signatureHtml)
    if (text === sigText) {
      return true
    }
  }

  return false
}

export interface EmailComposeHandle {
  saveDraftSilently: () => Promise<void>
}

interface EmailComposeProps {
  mode: ComposeMode
  replyTo?: Email | null
  initialTo?: EmailAddress[] | null
  onClose: () => void
  onSent: () => void
  onAutoSaved?: () => void
  onDraftDeleted?: (draftId: string) => void
  inline?: boolean
}

function buildInitialState(mode: ComposeMode, replyTo?: Email | null, initialTo?: EmailAddress[] | null) {
  if (mode === 'draft' && replyTo) {
    return {
      to: replyTo.to_addresses ?? [],
      cc: replyTo.cc_addresses ?? [],
      bcc: replyTo.bcc_addresses ?? [],
      showCcBcc: (replyTo.cc_addresses?.length ?? 0) > 0 || (replyTo.bcc_addresses?.length ?? 0) > 0,
      subject: replyTo.subject ?? '',
      bodyHtml: replyTo.body_html ?? replyTo.body_text ?? '<p></p>',
      attachments: replyTo.attachments ?? [],
      draftId: replyTo.id,
      isPlainText: replyTo.is_plain_text ?? false,
    }
  }

  return {
    to:
      mode === 'reply' && replyTo
        ? [{ email: replyTo.from_address, name: replyTo.from_name }]
        : initialTo ?? [],
    cc: [] as EmailAddress[],
    bcc: [] as EmailAddress[],
    showCcBcc: false,
    subject:
      mode === 'reply' && replyTo
        ? replyTo.subject?.startsWith('Re:')
          ? replyTo.subject
          : `Re: ${replyTo.subject ?? ''}`
        : mode === 'forward' && replyTo
          ? replyTo.subject?.startsWith('Fwd:')
            ? replyTo.subject
            : `Fwd: ${replyTo.subject ?? ''}`
          : '',
    bodyHtml:
      mode === 'forward' && replyTo
        ? `<p></p><hr/><p><b>---------- Пересланное сообщение ----------</b></p>${replyTo.body_html ?? replyTo.body_text ?? ''}`
        : '<p></p>',
    attachments: [] as Attachment[],
    draftId: undefined as string | undefined,
    isPlainText: false,
  }
}

export const EmailCompose = forwardRef<EmailComposeHandle, EmailComposeProps>(function EmailCompose(
  { mode, replyTo, initialTo, onClose, onSent, onAutoSaved, onDraftDeleted, inline = false },
  ref,
) {
  const initial = buildInitialState(mode, replyTo, initialTo)
  const [to, setTo] = useState<EmailAddress[]>(initial.to)
  const [cc, setCc] = useState<EmailAddress[]>(initial.cc)
  const [bcc, setBcc] = useState<EmailAddress[]>(initial.bcc)
  const [showCcBcc, setShowCcBcc] = useState(initial.showCcBcc)
  const [subject, setSubject] = useState(initial.subject)
  const [bodyHtml, setBodyHtml] = useState(initial.bodyHtml)
  const [attachments, setAttachments] = useState<Attachment[]>(initial.attachments)
  const [draftId, setDraftId] = useState<string | undefined>(initial.draftId)
  const [isPlainText, setIsPlainText] = useState(initial.isPlainText)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showScheduler, setShowScheduler] = useState(false)
  const [scheduleValue, setScheduleValue] = useState('')
  const toRef = useRef<RecipientInputHandle>(null)
  const ccRef = useRef<RecipientInputHandle>(null)
  const bccRef = useRef<RecipientInputHandle>(null)
  const discardRequestedRef = useRef(false)

  const draftStateRef = useRef({
    mode,
    inline,
    to,
    cc,
    bcc,
    subject,
    bodyHtml,
    attachments,
    draftId,
    isPlainText,
  })
  draftStateRef.current = { mode, inline, to, cc, bcc, subject, bodyHtml, attachments, draftId, isPlainText }

  const isDraftMode = mode === 'draft'
  const canUseCcBcc = mode === 'new' || isDraftMode
  const canAutoSaveDraft = mode === 'new' || isDraftMode

  const [signatureHtml, setSignatureHtml] = useState<string | null>(null)
  const [initialSignatureAppended, setInitialSignatureAppended] = useState(false)

  useEffect(() => {
    if ((mode === 'new' || mode === 'reply' || mode === 'forward') && !initialSignatureAppended) {
      api.getSettings().then((settings) => {
        const sig = settings.signature_html
        setSignatureHtml(sig)
        if (sig) {
          setBodyHtml((prev) => {
            if (prev.includes(sig)) return prev
            if (mode === 'forward') {
              if (prev.startsWith('<p></p>')) {
                return `<p></p><br/>${sig}<br/>${prev.substring(7)}`
              }
              return `<br/>${sig}<br/>${prev}`
            }
            return `${prev}<br/><br/>${sig}`
          })
        }
        setInitialSignatureAppended(true)
      }).catch(() => setInitialSignatureAppended(true))
    }
  }, [mode, initialSignatureAppended])

  function resolveRecipients(): { to: EmailAddress[]; cc: EmailAddress[]; bcc: EmailAddress[] } {
    const finalTo = toRef.current?.commitPending() ?? to
    const finalCc = ccRef.current?.commitPending() ?? cc
    const finalBcc = bccRef.current?.commitPending() ?? bcc
    setTo(finalTo)
    setCc(finalCc)
    setBcc(finalBcc)
    return { to: finalTo, cc: finalCc, bcc: finalBcc }
  }

  async function persistDraft(
    recipients?: { to: EmailAddress[]; cc: EmailAddress[]; bcc: EmailAddress[] },
  ): Promise<Email> {
    const resolved = recipients ?? resolveRecipients()
    const saved = await api.saveDraft({
      ...resolved,
      subject,
      bodyHtml,
      attachmentIds: attachments.map((a) => a.id),
      draftId,
      isPlainText,
    })
    setDraftId(saved.id)
    return saved
  }

  async function saveDraftSilently(): Promise<void> {
    const state = draftStateRef.current
    if (state.mode !== 'new' && state.mode !== 'draft') return

    const finalTo = toRef.current?.commitPending() ?? state.to
    const finalCc = ccRef.current?.commitPending() ?? state.cc
    const finalBcc = bccRef.current?.commitPending() ?? state.bcc

    if (!state.draftId && isDraftEmpty(finalTo, finalCc, finalBcc, state.subject, state.bodyHtml, state.attachments, signatureHtml)) {
      return
    }

    try {
      const saved = await api.saveDraft({
        to: finalTo,
        cc: finalCc,
        bcc: finalBcc,
        subject: state.subject,
        bodyHtml: state.bodyHtml,
        attachmentIds: state.attachments.map((a) => a.id),
        draftId: state.draftId,
        isPlainText: state.isPlainText,
      })
      draftStateRef.current.draftId = saved.id
      onAutoSaved?.()
    } catch {
      // тихое автосохранение
    }
  }

  useImperativeHandle(ref, () => ({ saveDraftSilently }), [onAutoSaved])

  useEffect(() => {
    return () => {
      const state = draftStateRef.current
      if (state.inline && state.mode === 'draft' && !discardRequestedRef.current) {
        void (async () => {
          try {
            const saved = await api.saveDraft({
              to: state.to,
              cc: state.cc,
              bcc: state.bcc,
              subject: state.subject,
              bodyHtml: state.bodyHtml,
              attachmentIds: state.attachments.map((a) => a.id),
              draftId: state.draftId,
              isPlainText: state.isPlainText,
            })
            draftStateRef.current.draftId = saved.id
            onAutoSaved?.()
          } catch {
            // ignore
          }
        })()
      }
    }
  }, [onAutoSaved])

  async function handleUpload(file: File) {
    if (isBlockedExecutableFile(file)) {
      setError('Исполняемые файлы прикреплять нельзя')
      return
    }
    const uploaded = await api.uploadAttachment(file)
    setAttachments((prev) => [...prev, uploaded])
  }

  async function handleImageUpload(file: File): Promise<string> {
    if (isBlockedExecutableFile(file)) {
      throw new Error('Исполняемые файлы прикреплять нельзя')
    }
    const uploaded = await api.uploadAttachment(file)
    setAttachments((prev) => [...prev, uploaded])
    const { data } = await http.get(`/attachments/${uploaded.id}`, { responseType: 'blob' })
    return URL.createObjectURL(data)
  }

  async function handleSaveDraft() {
    setError(null)
    setLoading(true)
    try {
      const resolved = resolveRecipients()
      if (!draftId && isDraftEmpty(resolved.to, resolved.cc, resolved.bcc, subject, bodyHtml, attachments, signatureHtml)) {
        handleDiscard()
        return
      }
      await persistDraft(resolved)
      onSent()
      onClose()
    } catch {
      setError('Не удалось сохранить черновик')
    } finally {
      setLoading(false)
    }
  }

  function handleDiscard() {
    discardRequestedRef.current = true
    onClose()
  }

  async function handleDeleteDraft() {
    discardRequestedRef.current = true
    const idToDelete = draftId

    if (!idToDelete) {
      onClose()
      return
    }

    draftStateRef.current.draftId = undefined
    setDraftId(undefined)

    setError(null)
    setLoading(true)
    try {
      await api.deleteEmail(idToDelete, true)
      onDraftDeleted?.(idToDelete)
      onSent()
      onClose()
    } catch {
      discardRequestedRef.current = false
      draftStateRef.current.draftId = idToDelete
      setDraftId(idToDelete)
      setError('Не удалось удалить черновик')
    } finally {
      setLoading(false)
    }
  }

  async function handleCloseWithSave() {
    if (!canAutoSaveDraft) {
      handleDiscard()
      return
    }

    const resolved = resolveRecipients()
    if (!draftId && isDraftEmpty(resolved.to, resolved.cc, resolved.bcc, subject, bodyHtml, attachments, signatureHtml)) {
      handleDiscard()
      return
    }

    setError(null)
    setLoading(true)
    try {
      await persistDraft(resolved)
      onSent()
      discardRequestedRef.current = true
      onClose()
    } catch {
      setError('Не удалось сохранить черновик')
    } finally {
      setLoading(false)
    }
  }

  function extractErrorMessage(err: unknown): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
      const data = (err as { response?: { data?: { error?: string; details?: { message: string }[] } } })
        .response?.data
      const detail = data?.details?.[0]?.message
      if (detail?.includes('email')) return 'Укажите корректный email получателя'
      if (data?.error) return data.error
    }
    return 'Ошибка отправки'
  }

  async function handleSchedule() {
    setError(null)
    if (!scheduleValue) {
      setError('Выберите дату и время отправки')
      return
    }
    const scheduledAt = new Date(scheduleValue).toISOString()
    if (new Date(scheduledAt) <= new Date()) {
      setError('Дата отправки должна быть в будущем')
      return
    }
    setLoading(true)
    try {
      const { to: finalTo, cc: finalCc, bcc: finalBcc } = resolveRecipients()
      if (finalTo.length === 0) {
        setError('Укажите хотя бы одного получателя')
        setLoading(false)
        return
      }
      await api.scheduleEmail({
        to: finalTo,
        cc: finalCc,
        bcc: finalBcc,
        subject,
        bodyHtml,
        attachmentIds: attachments.map((a) => a.id),
        draftId,
        scheduledAt,
        isPlainText,
      })
      discardRequestedRef.current = true
      onSent()
      onClose()
    } catch (err: unknown) {
      setError(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { to: finalTo, cc: finalCc, bcc: finalBcc } = resolveRecipients()

      if (finalTo.length === 0) {
        setError('Укажите хотя бы одного получателя')
        setLoading(false)
        return
      }

      const attachmentIds = attachments.map((a) => a.id)

      if (mode === 'reply' && replyTo) {
        await api.replyEmail(replyTo.id, bodyHtml, attachmentIds, isPlainText)
      } else if (mode === 'forward' && replyTo) {
        await api.forwardEmail(replyTo.id, finalTo, bodyHtml, isPlainText)
      } else {
        await api.sendEmail({
          to: finalTo,
          cc: finalCc,
          bcc: finalBcc,
          subject,
          bodyHtml,
          attachmentIds,
          draftId,
          isPlainText,
        })
      }

      discardRequestedRef.current = true
      onSent()
      onClose()
    } catch (err: unknown) {
      setError(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const title =
    mode === 'reply'
      ? 'Ответ'
      : mode === 'forward'
        ? 'Пересылка'
        : isDraftMode
          ? 'Редактирование черновика'
          : 'Новое письмо'

  const content = (
    <div className={inline ? styles.composeInline : styles.modal} onClick={(e) => e.stopPropagation()}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => void handleCloseWithSave()}
          aria-label="Закрыть и сохранить в черновики"
        >
          ×
        </button>
      </div>

      <form className={styles.body} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="compose-to">Кому</label>
          <RecipientInput
            ref={toRef}
            id="compose-to"
            value={to}
            onChange={setTo}
            placeholder="email@example.com"
          />
        </div>

        {!showCcBcc && canUseCcBcc && (
          <button type="button" className={styles.linkBtn} onClick={() => setShowCcBcc(true)}>
            Копия / Скрытая
          </button>
        )}

        {showCcBcc && canUseCcBcc && (
          <>
            <div className={styles.field}>
              <label className={styles.label}>Копия</label>
              <RecipientInput ref={ccRef} value={cc} onChange={setCc} placeholder="cc@example.com" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Скрытая копия</label>
              <RecipientInput ref={bccRef} value={bcc} onChange={setBcc} placeholder="bcc@example.com" />
            </div>
          </>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="compose-subject">Тема</label>
          <input
            id="compose-subject"
            className={styles.input}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required={mode === 'new' || isDraftMode}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Сообщение</label>
          <RichTextEditor
            value={bodyHtml}
            onChange={setBodyHtml}
            isPlainTextMode={isPlainText}
            onModeChange={setIsPlainText}
            onUploadImage={async (file) => {
              try {
                return await handleImageUpload(file)
              } catch {
                setError('Не удалось прикрепить изображение')
                throw new Error('upload failed')
              }
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.uploadBtn} title="Прикрепить файл" aria-label="Прикрепить файл">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <input
              className={styles.hiddenInput}
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleUpload(file).catch(() => setError('Не удалось загрузить файл'))
                e.target.value = ''
              }}
            />
          </label>
          {attachments.length > 0 && (
            <div className={styles.attachments}>
              {attachments.map((att) => (
                <span key={att.id} className={styles.attachChip}>
                  {att.filename} ({formatSize(att.size_bytes)})
                </span>
              ))}
            </div>
          )}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {showScheduler && (mode === 'new' || isDraftMode) && (
          <div className={styles.schedulerRow}>
            <input
              className={styles.input}
              type="datetime-local"
              value={scheduleValue}
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              onChange={(e) => setScheduleValue(e.target.value)}
            />
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={loading || !scheduleValue}
              onClick={() => void handleSchedule()}
            >
              {loading ? 'Сохранение…' : 'Запланировать'}
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setShowScheduler(false)}
            >
              Отмена
            </button>
          </div>
        )}

        <div className={styles.footer}>
          {canAutoSaveDraft && (
            <button
              type="button"
              className={styles.discardBtn}
              onClick={() => void handleDeleteDraft()}
              disabled={loading}
              title="Удалить черновик"
              aria-label="Удалить черновик"
            >
              🗑
            </button>
          )}
          <div className={styles.footerActions}>
            <button type="button" className={styles.secondaryBtn} onClick={handleDiscard}>
              Отмена
            </button>
            {(mode === 'new' || isDraftMode) && (
              <>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={loading}
                  onClick={() => void handleSaveDraft()}
                >
                  В черновики
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={loading}
                  onClick={() => setShowScheduler((v) => !v)}
                  title="Запланировать отправку"
                >
                  🕐 По расписанию
                </button>
              </>
            )}
            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={loading}
              onMouseDown={() => resolveRecipients()}
            >
              {loading ? 'Отправка…' : 'Отправить'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )

  if (inline) return content

  return <div className={styles.overlay}>{content}</div>
})
