import sanitizeHtml from 'sanitize-html'
import type { PoolClient } from 'pg'
import { getPool } from './db.service'
import { findUserByEmail, findUserById } from './auth.service'
import { resolveAliasAddress } from './alias.service'
import {
  getAttachmentMetaByIds,
  getAttachmentsForEmail,
  linkAttachmentsToEmail,
} from './attachment.service'
import { extractDomainFromEmail } from '../utils/emailDomain'
import { buildMessageId } from '../utils/messageId'
import { buildReferencesHeader } from '../utils/mailHeaders'
import { buildRawEmail } from '../utils/buildRawEmail'
import { validateFolderId } from './folder.service'
import { applyInboundRules } from './rule.service'
import { getUserSettings } from './settings.service'
import { collapseEmptyParagraphs } from '../utils/mailHtml'
import { sendExternalMail } from './mta.service'
import { notifyMailUpdatedMany } from './mailEvents.service'
import { sendNewEmailNotification, deleteTelegramNotification } from './telegram.service'
import { env } from '../config/env'
import type {
  BulkEmailAction,
  EmailAddress,
  EmailDetail,
  EmailListItem,
  SaveDraftInput,
  ScheduleEmailInput,
  SendEmailInput,
  UpdateEmailInput,
} from '../types/email'

const PAGE_SIZE = 50

interface EmailRow {
  id: string
  message_id: string | null
  user_id: string
  domain_id: string | null
  folder: string
  from_address: string
  from_name: string | null
  to_addresses: EmailAddress[]
  cc_addresses: EmailAddress[]
  bcc_addresses: EmailAddress[]
  subject: string | null
  body_text: string | null
  body_html: string | null
  raw_source: string | null
  is_read: boolean
  is_starred: boolean
  has_attachments: boolean
  in_reply_to: string | null
  received_at: Date | null
  sent_at: Date | null
  scheduled_at: Date | null
  created_at: Date
  is_plain_text: boolean
}

function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim()
}

function normalizeAddresses(addresses: EmailAddress[]): EmailAddress[] {
  return addresses.map((a) => ({
    email: a.email.trim().toLowerCase(),
    name: a.name?.trim() || null,
  }))
}

function collectRecipients(
  to: EmailAddress[],
  cc: EmailAddress[] = [],
  bcc: EmailAddress[] = [],
): EmailAddress[] {
  const seen = new Set<string>()
  const result: EmailAddress[] = []
  for (const addr of [...to, ...cc, ...bcc]) {
    const key = addr.email.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(addr)
    }
  }
  return result
}

async function getManagedDomainNames(): Promise<Set<string>> {
  const { rows } = await getPool().query<{ domain_name: string }>(
    'SELECT LOWER(domain_name) AS domain_name FROM domains WHERE is_active = true',
  )
  return new Set(rows.map((r) => r.domain_name))
}

function formatAddressList(addresses: EmailAddress[]): string {
  return addresses.map((a) => a.email).join(', ')
}

async function assertExternalDeliveryAllowed(external: EmailAddress[]): Promise<void> {
  if (external.length === 0 || env.MTA_ENABLED) return

  const managed = await getManagedDomainNames()
  const unknownOnManagedDomain = external.filter((a) => {
    const domain = extractDomainFromEmail(a.email)
    return domain !== null && managed.has(domain)
  })
  const trulyExternal = external.filter((a) => {
    const domain = extractDomainFromEmail(a.email)
    return domain === null || !managed.has(domain)
  })

  if (unknownOnManagedDomain.length > 0) {
    throw new Error(
      `Пользователь не найден или отключён: ${formatAddressList(unknownOnManagedDomain)}. ` +
        'Создайте ящик в админке или проверьте email.',
    )
  }

  if (trulyExternal.length > 0) {
    throw new Error(
      `Отправка на внешние адреса (${formatAddressList(trulyExternal)}) требует MTA. ` +
        'Добавьте docker-compose.mta.yml в стек Portainer и выполните redeploy.',
    )
  }
}

async function classifyRecipients(recipients: EmailAddress[]): Promise<{
  internal: EmailAddress[]
  external: EmailAddress[]
}> {
  const internal: EmailAddress[] = []
  const external: EmailAddress[] = []
  const seen = new Set<string>()

  for (const recipient of recipients) {
    let targetEmail = recipient.email.toLowerCase()
    const aliasTarget = await resolveAliasAddress(targetEmail)
    if (aliasTarget) targetEmail = aliasTarget
    if (seen.has(targetEmail)) continue
    seen.add(targetEmail)

    const user = await findUserByEmail(targetEmail)
    if (user?.is_active) {
      internal.push({ ...recipient, email: targetEmail })
    } else {
      external.push(recipient)
    }
  }

  return { internal, external }
}

function filterExternalAddresses(
  addresses: EmailAddress[],
  externalEmails: Set<string>,
): EmailAddress[] {
  return addresses.filter((a) => externalEmails.has(a.email.toLowerCase()))
}

function toListItem(row: EmailRow): EmailListItem {
  return {
    id: row.id,
    folder: row.folder,
    from_address: row.from_address,
    from_name: row.from_name,
    to_addresses: row.to_addresses ?? [],
    subject: row.subject,
    body_text: row.body_text,
    is_read: row.is_read,
    is_starred: row.is_starred,
    has_attachments: row.has_attachments,
    received_at: row.received_at?.toISOString() ?? null,
    sent_at: row.sent_at?.toISOString() ?? null,
    scheduled_at: row.scheduled_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    is_plain_text: row.is_plain_text,
  }
}

async function mapRow(row: EmailRow): Promise<EmailDetail> {
  const attachments = await getAttachmentsForEmail(row.id)
  return {
    ...toListItem(row),
    cc_addresses: row.cc_addresses ?? [],
    bcc_addresses: row.bcc_addresses ?? [],
    body_html: row.body_html,
    message_id: row.message_id,
    in_reply_to: row.in_reply_to,
    raw_source: row.raw_source,
    attachments,
  }
}

export async function listEmails(
  userId: string,
  options: {
    folder: string
    page?: number
    search?: string
    sort?: string
  },
): Promise<{ emails: EmailListItem[]; total: number; page: number; hasMore: boolean }> {
  const page = Math.max(1, options.page ?? 1)
  const offset = (page - 1) * PAGE_SIZE
  const search = options.search?.trim() ?? ''
  const sortField = options.sort?.startsWith('subject') ? 'subject' : 'COALESCE(received_at, sent_at, created_at)'

  const params: unknown[] = [userId]
  let folderClause = ''
  let searchClause = ''

  if (search) {
    params.push(`%${search}%`)
    searchClause = `AND (subject ILIKE $2 OR body_text ILIKE $2 OR from_address ILIKE $2)`
  } else if (options.folder === 'starred') {
    folderClause = `AND is_starred = true AND folder NOT IN ('trash', 'spam')`
  } else {
    params.push(options.folder)
    folderClause = `AND folder = $2`
  }

  const countQuery = `
    SELECT COUNT(*)::int AS total FROM emails
    WHERE user_id = $1 ${folderClause} ${searchClause}
  `
  const listQuery = `
    SELECT id, message_id, user_id, domain_id, folder, from_address, from_name,
           to_addresses, cc_addresses, bcc_addresses, subject, body_text, body_html,
           is_read, is_starred, has_attachments, in_reply_to, received_at, sent_at, scheduled_at, raw_source, created_at
    FROM emails
    WHERE user_id = $1 ${folderClause} ${searchClause}
    ORDER BY ${sortField} DESC NULLS LAST
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `

  const [countResult, listResult] = await Promise.all([
    getPool().query<{ total: number }>(countQuery, params),
    getPool().query<EmailRow>(listQuery, params),
  ])

  const total = countResult.rows[0]?.total ?? 0
  return {
    emails: listResult.rows.map(toListItem),
    total,
    page,
    hasMore: offset + listResult.rows.length < total,
  }
}

export async function getEmailById(userId: string, emailId: string): Promise<EmailDetail | null> {
  const { rows } = await getPool().query<EmailRow>(
    `SELECT id, message_id, user_id, domain_id, folder, from_address, from_name,
            to_addresses, cc_addresses, bcc_addresses, subject, body_text, body_html,
            is_read, is_starred, has_attachments, in_reply_to, received_at, sent_at, scheduled_at, raw_source, created_at
     FROM emails WHERE id = $1 AND user_id = $2`,
    [emailId, userId],
  )
  if (!rows[0]) return null
  return mapRow(rows[0])
}

function normalizeThreadSubject(subject: string | null): string {
  if (!subject) return ''
  return subject.replace(/^(re|fwd|fw):\s*/gi, '').trim().toLowerCase()
}

function emailTimestamp(row: EmailRow): number {
  const d = row.received_at ?? row.sent_at ?? row.created_at
  return d instanceof Date ? d.getTime() : new Date(d).getTime()
}

/** Цепочка писем по Message-ID / In-Reply-To (и теме с тем же корреспондентом). */
export async function getEmailThread(userId: string, emailId: string): Promise<EmailDetail[]> {
  const { rows: allRows } = await getPool().query<EmailRow>(
    `SELECT id, message_id, user_id, domain_id, folder, from_address, from_name,
            to_addresses, cc_addresses, bcc_addresses, subject, body_text, body_html,
            is_read, is_starred, has_attachments, in_reply_to, received_at, sent_at, scheduled_at, raw_source, created_at
     FROM emails WHERE user_id = $1`,
    [userId],
  )

  const seed = allRows.find((r) => r.id === emailId)
  if (!seed) return []

  const relatedIds = new Set<string>([emailId])
  const messageIds = new Set<string>()
  const inReplyTos = new Set<string>()

  const linkRow = (row: EmailRow): void => {
    relatedIds.add(row.id)
    if (row.message_id) messageIds.add(row.message_id)
    if (row.in_reply_to) inReplyTos.add(row.in_reply_to)
  }

  linkRow(seed)

  let changed = true
  while (changed) {
    changed = false
    for (const row of allRows) {
      if (relatedIds.has(row.id)) continue
      const mid = row.message_id ?? ''
      const irt = row.in_reply_to ?? ''
      const linked = (mid.length > 0 && inReplyTos.has(mid)) || (irt.length > 0 && messageIds.has(irt))
      if (linked) {
        linkRow(row)
        changed = true
      }
    }
  }

  if (relatedIds.size === 1 && seed.subject) {
    const normSubject = normalizeThreadSubject(seed.subject)
    const seedFrom = seed.from_address.toLowerCase()
    const seedTo = seed.to_addresses[0]?.email.toLowerCase() ?? ''
    for (const row of allRows) {
      if (relatedIds.has(row.id)) continue
      if (normalizeThreadSubject(row.subject) !== normSubject) continue
      const from = row.from_address.toLowerCase()
      const to = row.to_addresses[0]?.email.toLowerCase() ?? ''
      const sameCorrespondents =
        from === seedFrom || to === seedFrom || from === seedTo || to === seedTo
      if (sameCorrespondents) relatedIds.add(row.id)
    }
  }

  const threadRows = allRows
    .filter((r) => relatedIds.has(r.id))
    .sort((a, b) => emailTimestamp(a) - emailTimestamp(b))

  return Promise.all(threadRows.map((row) => mapRow(row)))
}

async function insertEmail(
  client: PoolClient,
  data: {
    userId: string
    domainId: string | null
    folder: string
    fromAddress: string
    fromName: string | null
    to: EmailAddress[]
    cc: EmailAddress[]
    bcc: EmailAddress[]
    subject: string
    bodyHtml: string
    messageId: string
    inReplyTo?: string | null
    sentAt?: Date | null
    receivedAt?: Date | null
    isRead?: boolean
    hasAttachments?: boolean
    rawSource?: string | null
    isPlainText?: boolean
  },
): Promise<string> {
  const bodyText = htmlToText(data.bodyHtml)
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO emails (
       user_id, domain_id, folder, from_address, from_name,
       to_addresses, cc_addresses, bcc_addresses,
       subject, body_text, body_html, message_id, in_reply_to,
       sent_at, received_at, is_read, has_attachments, size_bytes, raw_source, is_plain_text
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING id`,
    [
      data.userId,
      data.domainId,
      data.folder,
      data.fromAddress,
      data.fromName,
      JSON.stringify(data.to),
      JSON.stringify(data.cc),
      JSON.stringify(data.bcc),
      data.subject,
      bodyText,
      data.bodyHtml,
      data.messageId,
      data.inReplyTo ?? null,
      data.sentAt ?? null,
      data.receivedAt ?? null,
      data.isRead ?? false,
      data.hasAttachments ?? false,
      Buffer.byteLength(data.bodyHtml, 'utf8'),
      data.rawSource ?? null,
      data.isPlainText ?? false,
    ],
  )
  return rows[0].id
}

async function deliverToRecipients(
  client: PoolClient,
  sender: { id: string; email: string; display_name: string | null; domain_id: string | null },
  recipients: EmailAddress[],
  mail: {
    subject: string
    bodyHtml: string
    messageId: string
    inReplyTo?: string | null
    hasAttachments: boolean
    to: EmailAddress[]
    cc: EmailAddress[]
    bcc: EmailAddress[]
    rawSource?: string | null
    isPlainText?: boolean
  },
): Promise<{ userId: string; emailId: string; folder: string }[]> {
  const now = new Date()
  const deliveries: { userId: string; emailId: string; folder: string }[] = []
  for (const recipient of recipients) {
    let targetEmail = recipient.email
    const aliasTarget = await resolveAliasAddress(targetEmail)
    if (aliasTarget) targetEmail = aliasTarget

    if (targetEmail === sender.email.toLowerCase()) continue
    const user = await findUserByEmail(targetEmail)
    if (!user || !user.is_active) continue

    const toAddressesStr = mail.to.map((a) => a.email).join(', ')
    const rules = await applyInboundRules(user.id, {
      fromAddress: sender.email,
      subject: mail.subject,
      toAddresses: toAddressesStr,
    })

    let folder = rules.folder ?? 'inbox'
    if (rules.delete) folder = 'trash'

    const emailId = await insertEmail(client, {
      userId: user.id,
      domainId: user.domain_id,
      folder,
      fromAddress: sender.email,
      fromName: sender.display_name,
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      subject: mail.subject,
      bodyHtml: mail.bodyHtml,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      receivedAt: now,
      isRead: rules.markRead ?? false,
      hasAttachments: mail.hasAttachments,
      rawSource: mail.rawSource,
      isPlainText: mail.isPlainText,
    })

    if (rules.star) {
      await client.query('UPDATE emails SET is_starred = true WHERE id = $1', [emailId])
    }

    deliveries.push({ userId: user.id, emailId, folder })

    const autoReply = await maybeSendAutoReply(client, user.id, sender, mail.subject)
    if (autoReply) deliveries.push({ userId: autoReply.userId, emailId: autoReply.emailId, folder: 'inbox' })
  }
  return deliveries
}

async function maybeSendAutoReply(
  client: PoolClient,
  recipientUserId: string,
  sender: { id: string; email: string; display_name: string | null; domain_id: string | null },
  originalSubject: string,
): Promise<{ userId: string; emailId: string } | null> {
  if (originalSubject.toLowerCase().startsWith('auto:')) return null

  const settings = await getUserSettings(recipientUserId)
  if (!settings?.auto_reply_enabled || !settings.auto_reply_body?.trim()) return null

  const recipient = await findUserById(recipientUserId)
  if (!recipient || recipient.email === sender.email.toLowerCase()) return null

  const subject = settings.auto_reply_subject?.trim() || `Auto: Re: ${originalSubject}`
  const bodyHtml = settings.auto_reply_body.trim()
  const messageId = buildMessageId(sender.email, 'auto')

  const autoReplyEmailId = await insertEmail(client, {
    userId: sender.id,
    domainId: sender.domain_id,
    folder: 'inbox',
    fromAddress: recipient.email,
    fromName: recipient.display_name,
    to: [{ email: sender.email, name: sender.display_name }],
    cc: [],
    bcc: [],
    subject,
    bodyHtml,
    messageId,
    receivedAt: new Date(),
    isRead: false,
    hasAttachments: false,
  })

  return { userId: sender.id, emailId: autoReplyEmailId }
}


export async function sendEmail(userId: string, input: SendEmailInput): Promise<EmailDetail> {
  const sender = await findUserById(userId)
  if (!sender) throw new Error('Sender not found')

  const to = normalizeAddresses(input.to)
  if (to.length === 0) throw new Error('At least one recipient is required')

  const cc = normalizeAddresses(input.cc ?? [])
  const bcc = normalizeAddresses(input.bcc ?? [])
  const bodyHtml = collapseEmptyParagraphs(input.bodyHtml)
  const subject = input.subject.trim()
  const messageId = buildMessageId(sender.email)
  const attachmentIds = input.attachmentIds ?? []
  const hasAttachments = attachmentIds.length > 0
  const now = new Date()
  const allRecipients = collectRecipients(to, cc, bcc)
  const { internal, external } = await classifyRecipients(allRecipients)

  await assertExternalDeliveryAllowed(external)

  const attachmentMeta = hasAttachments ? await getAttachmentMetaByIds(attachmentIds) : []
  const rawSource = buildRawEmail({
    messageId,
    date: now,
    from: { email: sender.email, name: sender.display_name },
    to,
    cc,
    bcc,
    subject,
    bodyHtml,
    inReplyTo: input.inReplyTo,
    references: input.references,
    attachments: attachmentMeta,
    isPlainText: input.isPlainText,
  })

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    if (input.draftId) {
      await client.query('DELETE FROM emails WHERE id = $1 AND user_id = $2 AND folder = $3', [
        input.draftId,
        userId,
        'drafts',
      ])
    }

    const sentEmailId = await insertEmail(client, {
      userId,
      domainId: sender.domain_id,
      folder: 'sent',
      fromAddress: sender.email,
      fromName: sender.display_name,
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      messageId,
      inReplyTo: input.inReplyTo ?? null,
      sentAt: now,
      isRead: true,
      hasAttachments,
      rawSource,
      isPlainText: input.isPlainText,
    })

    await linkAttachmentsToEmail(userId, sentEmailId, attachmentIds)

    const deliveries = await deliverToRecipients(
      client,
      sender,
      internal,
      { subject, bodyHtml, messageId, inReplyTo: input.inReplyTo, hasAttachments, to, cc, bcc, rawSource, isPlainText: input.isPlainText },
    )

    await client.query('COMMIT')

    const userIdsForSse = Array.from(new Set(deliveries.map((d) => d.userId)))
    notifyMailUpdatedMany(userIdsForSse, { folder: 'inbox' })

    const bodyText = sanitizeHtml(bodyHtml, { allowedTags: [], allowedAttributes: {} }).trim()
    for (const d of deliveries) {
      if (d.folder === 'inbox') {
        sendNewEmailNotification(d.userId, d.emailId, {
          from_address: sender.email,
          from_name: sender.display_name,
          subject,
          body_text: bodyText,
        }).catch((err) => console.error('[Telegram] Error sending internal notification:', err))
      }
    }


    if (external.length > 0) {
      const externalEmails = new Set(external.map((a) => a.email.toLowerCase()))
      await sendExternalMail({
        from: sender.email,
        fromName: sender.display_name,
        to: filterExternalAddresses(to, externalEmails),
        cc: filterExternalAddresses(cc, externalEmails),
        bcc: filterExternalAddresses(bcc, externalEmails),
        subject,
        html: bodyHtml,
        messageId,
        inReplyTo: input.inReplyTo,
        references: input.references,
        attachmentIds,
        isPlainText: input.isPlainText,
      })
    }

    const email = await getEmailById(userId, sentEmailId)
    if (!email) throw new Error('Failed to load sent email')
    return email
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function saveDraft(userId: string, input: SaveDraftInput): Promise<EmailDetail> {
  const sender = await findUserById(userId)
  if (!sender) throw new Error('Sender not found')

  const to = normalizeAddresses(input.to ?? [])
  const cc = normalizeAddresses(input.cc ?? [])
  const bcc = normalizeAddresses(input.bcc ?? [])
  const bodyHtml = input.bodyHtml ?? ''
  const subject = input.subject?.trim() ?? ''
  const attachmentIds = input.attachmentIds ?? []

  if (input.draftId) {
    const existing = await getEmailById(userId, input.draftId)
    if (!existing || existing.folder !== 'drafts') {
      throw new Error('Draft not found')
    }

    await getPool().query(
      `UPDATE emails SET
         to_addresses = $3, cc_addresses = $4, bcc_addresses = $5,
         subject = $6, body_text = $7, body_html = $8,
         has_attachments = $9, size_bytes = $10, is_plain_text = $11
       WHERE id = $1 AND user_id = $2`,
      [
        input.draftId,
        userId,
        JSON.stringify(to),
        JSON.stringify(cc),
        JSON.stringify(bcc),
        subject,
        htmlToText(bodyHtml),
        bodyHtml,
        attachmentIds.length > 0,
        Buffer.byteLength(bodyHtml, 'utf8'),
        input.isPlainText ?? false,
      ],
    )
    await linkAttachmentsToEmail(userId, input.draftId, attachmentIds)
    const updated = await getEmailById(userId, input.draftId)
    if (!updated) throw new Error('Failed to load draft')
    return updated
  }

  const messageId = buildMessageId(sender.email, 'draft')
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO emails (
       user_id, domain_id, folder, from_address, from_name,
       to_addresses, cc_addresses, bcc_addresses,
       subject, body_text, body_html, message_id, has_attachments, size_bytes, is_plain_text
     ) VALUES ($1,$2,'drafts',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      userId,
      sender.domain_id,
      sender.email,
      sender.display_name,
      JSON.stringify(to),
      JSON.stringify(cc),
      JSON.stringify(bcc),
      subject,
      htmlToText(bodyHtml),
      bodyHtml,
      messageId,
      attachmentIds.length > 0,
      Buffer.byteLength(bodyHtml, 'utf8'),
      input.isPlainText ?? false,
    ],
  )

  await linkAttachmentsToEmail(userId, rows[0].id, attachmentIds)
  const draft = await getEmailById(userId, rows[0].id)
  if (!draft) throw new Error('Failed to load draft')
  return draft
}

export async function updateEmail(
  userId: string,
  emailId: string,
  input: UpdateEmailInput,
): Promise<EmailDetail | null> {
  if (input.folder && !validateFolderId(input.folder)) {
    throw new Error('Invalid folder')
  }

  const sets: string[] = []
  const params: unknown[] = [emailId, userId]

  if (input.is_read !== undefined) {
    params.push(input.is_read)
    sets.push(`is_read = $${params.length}`)
  }
  if (input.is_starred !== undefined) {
    params.push(input.is_starred)
    sets.push(`is_starred = $${params.length}`)
  }
  if (input.folder !== undefined) {
    params.push(input.folder)
    sets.push(`folder = $${params.length}`)
  }

  if (sets.length === 0) return getEmailById(userId, emailId)

  await getPool().query(
    `UPDATE emails SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`,
    params,
  )

  if (input.is_read === true) {
    deleteTelegramNotification(userId, emailId).catch((err) =>
      console.error('[Telegram] Error deleting notification on read:', err),
    )
  }

  return getEmailById(userId, emailId)
}

export async function deleteEmail(
  userId: string,
  emailId: string,
  permanent = false,
): Promise<boolean> {
  const email = await getEmailById(userId, emailId)
  if (!email) return false

  // Если письмо было в папке запланированных, отменяем задачу в планировщике
  if (email.folder === 'scheduled') {
    try {
      const { cancelScheduledEmail } = await import('./scheduler.service')
      await cancelScheduledEmail(emailId)
    } catch (err: any) {
      console.error('[Scheduler] Error cancelling email on delete:', err.message)
    }
  }

  if (permanent) {
    const { rowCount } = await getPool().query(
      'DELETE FROM emails WHERE id = $1 AND user_id = $2',
      [emailId, userId],
    )
    return (rowCount ?? 0) > 0
  }

  if (email.folder === 'trash') {
    return deleteEmail(userId, emailId, true)
  }

  await getPool().query(
    `UPDATE emails SET folder = 'trash' WHERE id = $1 AND user_id = $2`,
    [emailId, userId],
  )
  return true
}

export async function replyToEmail(
  userId: string,
  emailId: string,
  bodyHtml: string,
  attachmentIds: string[] = [],
  isPlainText?: boolean,
): Promise<EmailDetail> {
  const original = await getEmailById(userId, emailId)
  if (!original) throw new Error('Email not found')

  const thread = await getEmailThread(userId, emailId)
  const references = buildReferencesHeader(thread)

  const subject = original.subject?.startsWith('Re:')
    ? original.subject
    : `Re: ${original.subject ?? ''}`

  return sendEmail(userId, {
    to: [{ email: original.from_address, name: original.from_name }],
    subject,
    bodyHtml,
    attachmentIds,
    inReplyTo: original.message_id,
    references,
    isPlainText,
  })
}

export async function forwardEmail(
  userId: string,
  emailId: string,
  to: EmailAddress[],
  bodyHtml: string,
  isPlainText?: boolean,
): Promise<EmailDetail> {
  const original = await getEmailById(userId, emailId)
  if (!original) throw new Error('Email not found')

  const subject = original.subject?.startsWith('Fwd:')
    ? original.subject
    : `Fwd: ${original.subject ?? ''}`

  const forwardedBody = `${bodyHtml}<hr/><p><b>---------- Пересланное сообщение ----------</b></p>${original.body_html ?? original.body_text ?? ''}`

  return sendEmail(userId, { to, subject, bodyHtml: forwardedBody, isPlainText })
}

export async function bulkEmailAction(userId: string, input: BulkEmailAction): Promise<number> {
  if (input.ids.length === 0) return 0

  const ids = input.ids

  switch (input.action) {
    case 'read': {
      const res = await runBulkUpdate(userId, ids, 'is_read = true')
      for (const id of ids) {
        deleteTelegramNotification(userId, id).catch((err) =>
          console.error('[Telegram] Error deleting notification on bulk read:', err),
        )
      }
      return res
    }
    case 'unread':
      return runBulkUpdate(userId, ids, 'is_read = false')
    case 'star':
      return runBulkUpdate(userId, ids, 'is_starred = true')
    case 'unstar':
      return runBulkUpdate(userId, ids, 'is_starred = false')
    case 'trash':
      return runBulkUpdate(userId, ids, `folder = 'trash'`)
    case 'move': {
      if (!input.folder || !validateFolderId(input.folder)) throw new Error('Invalid folder')
      const { rowCount } = await getPool().query(
        'UPDATE emails SET folder = $3 WHERE user_id = $1 AND id = ANY($2::uuid[])',
        [userId, ids, input.folder],
      )
      return rowCount ?? 0
    }
    case 'delete': {
      const { rowCount } = await getPool().query(
        'DELETE FROM emails WHERE user_id = $1 AND id = ANY($2::uuid[])',
        [userId, ids],
      )
      return rowCount ?? 0
    }
    default:
      return 0
  }
}

async function runBulkUpdate(userId: string, ids: string[], setClause: string): Promise<number> {
  const { rowCount } = await getPool().query(
    `UPDATE emails SET ${setClause} WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, ids],
  )
  return rowCount ?? 0
}

export async function markEmailRead(userId: string, emailId: string): Promise<void> {
  await getPool().query(
    'UPDATE emails SET is_read = true WHERE id = $1 AND user_id = $2',
    [emailId, userId],
  )
  deleteTelegramNotification(userId, emailId).catch((err) =>
    console.error('[Telegram] Error deleting notification in markEmailRead:', err)
  )
}

/** Сохранить письмо в папку «Запланировано» для отправки в назначенное время. */
export async function scheduleEmail(
  userId: string,
  input: ScheduleEmailInput,
): Promise<EmailDetail> {
  const sender = await findUserById(userId)
  if (!sender) throw new Error('Sender not found')

  const scheduledAt = new Date(input.scheduledAt)
  if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
    throw new Error('Дата отправки должна быть в будущем')
  }

  const to = normalizeAddresses(input.to)
  if (to.length === 0) throw new Error('At least one recipient is required')

  const cc = normalizeAddresses(input.cc ?? [])
  const bcc = normalizeAddresses(input.bcc ?? [])
  const bodyHtml = collapseEmptyParagraphs(input.bodyHtml)
  const subject = input.subject.trim()
  const messageId = buildMessageId(sender.email)
  const attachmentIds = input.attachmentIds ?? []

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    if (input.draftId) {
      await client.query('DELETE FROM emails WHERE id = $1 AND user_id = $2 AND folder = $3', [
        input.draftId,
        userId,
        'drafts',
      ])
    }

    const bodyText = sanitizeHtml(bodyHtml, { allowedTags: [], allowedAttributes: {} }).trim()
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO emails (
         user_id, domain_id, folder, from_address, from_name,
         to_addresses, cc_addresses, bcc_addresses,
         subject, body_text, body_html, message_id,
         scheduled_at, is_read, has_attachments, size_bytes, is_plain_text
       ) VALUES ($1,$2,'scheduled',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15)
       RETURNING id`,
      [
        userId,
        sender.domain_id,
        sender.email,
        sender.display_name,
        JSON.stringify(to),
        JSON.stringify(cc),
        JSON.stringify(bcc),
        subject,
        bodyText,
        bodyHtml,
        messageId,
        scheduledAt,
        attachmentIds.length > 0,
        Buffer.byteLength(bodyHtml, 'utf8'),
        input.isPlainText ?? false,
      ],
    )

    const emailId = rows[0].id
    await linkAttachmentsToEmail(userId, emailId, attachmentIds)
    await client.query('COMMIT')

    // Запускаем планирование отправки письма
    const { scheduleEmail: runSchedule } = await import('./scheduler.service')
    await runSchedule(emailId, scheduledAt)

    const email = await getEmailById(userId, emailId)
    if (!email) throw new Error('Failed to load scheduled email')
    return email
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Вернуть запланированное письмо в черновики (отмена расписания). */
export async function unscheduleEmail(userId: string, emailId: string): Promise<EmailDetail | null> {
  const { rows } = await getPool().query<{ id: string }>(
    `UPDATE emails SET folder = 'drafts', scheduled_at = NULL
     WHERE id = $1 AND user_id = $2 AND folder = 'scheduled'
     RETURNING id`,
    [emailId, userId],
  )
  if (!rows[0]) return null

  // Отменяем задачу в планировщике
  const { cancelScheduledEmail } = await import('./scheduler.service')
  await cancelScheduledEmail(emailId)

  return getEmailById(userId, rows[0].id)
}



/** Отправить конкретное запланированное письмо */
export async function sendScheduledEmail(emailId: string): Promise<boolean> {
  const { rows } = await getPool().query<EmailRow>(
    `SELECT id, message_id, user_id, domain_id, folder, from_address, from_name,
            to_addresses, cc_addresses, bcc_addresses, subject, body_text, body_html,
            is_read, is_starred, has_attachments, in_reply_to, received_at, sent_at, scheduled_at, raw_source, created_at, is_plain_text
     FROM emails WHERE id = $1 AND folder = 'scheduled'`,
    [emailId]
  )
  const row = rows[0]
  if (!row) return false

  const sender = await findUserById(row.user_id)
  if (!sender) return false

  const to = normalizeAddresses(row.to_addresses)
  const cc = normalizeAddresses(row.cc_addresses)
  const bcc = normalizeAddresses(row.bcc_addresses)
  const allRecipients = collectRecipients(to, cc, bcc)
  const { internal, external } = await classifyRecipients(allRecipients)
  const now = new Date()
  const messageId = row.message_id ?? buildMessageId(sender.email)
  const subject = row.subject ?? ''
  const bodyHtml = row.body_html ?? row.body_text ?? ''
  const attachmentMetas = row.has_attachments ? await getAttachmentsForEmail(row.id) : []
  const rawSource = buildRawEmail({
    messageId,
    date: now,
    from: { email: sender.email, name: sender.display_name },
    to,
    cc,
    bcc,
    subject,
    bodyHtml,
    inReplyTo: row.in_reply_to,
    attachments: attachmentMetas,
    isPlainText: row.is_plain_text,
  })

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE emails SET folder = 'sent', sent_at = $2, scheduled_at = NULL, raw_source = $3
       WHERE id = $1`,
      [row.id, now, rawSource],
    )

    const deliveries = await deliverToRecipients(
      client,
      sender,
      internal,
      {
        subject,
        bodyHtml,
        messageId,
        inReplyTo: row.in_reply_to,
        hasAttachments: row.has_attachments,
        to,
        cc,
        bcc,
        rawSource,
        isPlainText: row.is_plain_text,
      },
    )

    await client.query('COMMIT')

    const bodyText = sanitizeHtml(bodyHtml, { allowedTags: [], allowedAttributes: {} }).trim()
    for (const d of deliveries) {
      if (d.folder === 'inbox') {
        sendNewEmailNotification(d.userId, d.emailId, {
          from_address: sender.email,
          from_name: sender.display_name,
          subject,
          body_text: bodyText,
        }).catch((err) => console.error('[Telegram] Error sending scheduled notification:', err))
      }
    }

    if (external.length > 0 && env.MTA_ENABLED) {
      const externalEmails = new Set(external.map((a) => a.email.toLowerCase()))
      await sendExternalMail({
        from: sender.email,
        fromName: sender.display_name,
        to: filterExternalAddresses(to, externalEmails),
        cc: filterExternalAddresses(cc, externalEmails),
        bcc: filterExternalAddresses(bcc, externalEmails),
        subject,
        html: bodyHtml,
        messageId,
        inReplyTo: row.in_reply_to,
        attachmentIds: attachmentMetas.map((a) => a.id),
        isPlainText: row.is_plain_text,
      })
    }

    return true
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Обработать запланированные письма (вызывается при синхронизации или fallback cron). */
export async function processDueScheduledEmails(): Promise<number> {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM emails WHERE folder = 'scheduled' AND scheduled_at <= NOW() LIMIT 50`
  )

  if (rows.length === 0) return 0

  let sent = 0
  for (const row of rows) {
    try {
      const ok = await sendScheduledEmail(row.id)
      if (ok) sent++
    } catch (err: any) {
      console.error(`[Scheduled] Error processing email ${row.id}:`, err.message)
    }
  }

  return sent
}
