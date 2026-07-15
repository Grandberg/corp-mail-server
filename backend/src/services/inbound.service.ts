import { simpleParser, type AddressObject } from 'mailparser'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { getPool } from './db.service'
import { env } from '../config/env'
import { findUserByEmail } from './auth.service'
import { resolveAliasAddress } from './alias.service'
import { applyInboundRules } from './rule.service'
import { notifyMailUpdated } from './mailEvents.service'
import { sendNewEmailNotification } from './telegram.service'

import type { EmailAddress } from '../types/email'

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseAddressList(value: AddressObject | AddressObject[] | undefined): EmailAddress[] {
  if (!value) return []
  const list = Array.isArray(value) ? value : [value]
  const result: EmailAddress[] = []
  for (const item of list) {
    for (const entry of item.value ?? []) {
      if (entry.address) {
        result.push({ email: entry.address.toLowerCase(), name: entry.name ?? null })
      }
    }
  }
  return result
}

export async function processInboundRawEmail(
  recipientEmail: string,
  rawBase64: string,
): Promise<{ delivered: boolean; reason?: string }> {
  let targetEmail = recipientEmail.trim().toLowerCase()
  const aliasTarget = await resolveAliasAddress(targetEmail)
  if (aliasTarget) targetEmail = aliasTarget

  const user = await findUserByEmail(targetEmail)
  if (!user || !user.is_active) {
    return { delivered: false, reason: 'unknown_recipient' }
  }

  const raw = Buffer.from(rawBase64, 'base64')
  const parsed = await simpleParser(raw)

  const fromAddress = parsed.from?.value?.[0]?.address?.toLowerCase() ?? 'unknown@external'
  const fromName = parsed.from?.value?.[0]?.name ?? null
  const subject = parsed.subject ?? '(без темы)'
  const bodyHtml = typeof parsed.html === 'string' ? parsed.html : `<pre>${parsed.text ?? ''}</pre>`
  const bodyText = parsed.text ?? htmlToText(bodyHtml)
  const messageId = parsed.messageId ?? `<${randomUUID()}@external>`
  const toAddresses = parseAddressList(parsed.to)
  const ccAddresses = parseAddressList(parsed.cc)
  const inReplyTo = parsed.inReplyTo ?? null
  const hasAttachments = (parsed.attachments?.length ?? 0) > 0

  // Анализ Rspamd заголовков для выявления спама
  const spamScoreHeader = parsed.headers?.get('x-spam-score')
  let spamScore: number | null = null
  if (spamScoreHeader) {
    const val = Array.isArray(spamScoreHeader) ? spamScoreHeader[0] : spamScoreHeader
    const scoreStr = typeof val === 'object' && val && 'value' in val ? String((val as { value: unknown }).value) : String(val)
    const parsedScore = parseFloat(scoreStr)
    if (!isNaN(parsedScore)) {
      spamScore = parsedScore
    }
  }

  const spamFlagHeader = parsed.headers?.get('x-spam-flag')
  const spamHeader = parsed.headers?.get('x-spam')
  let isSpam = false
  const checkSpamFlag = (h: unknown) => {
    if (!h) return false
    const val = Array.isArray(h) ? h[0] : h
    const flagStr = typeof val === 'object' && val && 'value' in val ? String((val as { value: unknown }).value) : String(val)
    return flagStr.toLowerCase().includes('yes') || flagStr.toLowerCase().includes('true')
  }

  if (checkSpamFlag(spamFlagHeader) || checkSpamFlag(spamHeader)) {
    isSpam = true
  } else {
    const spamStatusHeader = parsed.headers?.get('x-spam-status')
    if (spamStatusHeader) {
      const val = Array.isArray(spamStatusHeader) ? spamStatusHeader[0] : spamStatusHeader
      const statusStr = typeof val === 'object' && val && 'value' in val ? String((val as { value: unknown }).value) : String(val)
      if (statusStr.toLowerCase().startsWith('yes')) {
        isSpam = true
      }
    }
  }

  const headersObj: Record<string, unknown> = {}
  if (parsed.headers) {
    for (const [key, value] of parsed.headers.entries()) {
      headersObj[key] = value
    }
  }

  const rules = await applyInboundRules(user.id, {
    fromAddress,
    subject,
    toAddresses: toAddresses.map((a) => a.email).join(', '),
  })

  let folder = rules.folder ?? (isSpam ? 'spam' : 'inbox')
  if (rules.delete) folder = 'trash'

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO emails (
         user_id, domain_id, folder, from_address, from_name,
         to_addresses, cc_addresses, bcc_addresses,
         subject, body_text, body_html, message_id, in_reply_to,
         received_at, is_read, is_starred, has_attachments, size_bytes, raw_source,
         spam_score, headers
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'[]',$8,$9,$10,$11,$12,NOW(),$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        user.id,
        user.domain_id,
        folder,
        fromAddress,
        fromName,
        JSON.stringify(toAddresses.length ? toAddresses : [{ email: targetEmail }]),
        JSON.stringify(ccAddresses),
        subject,
        bodyText,
        bodyHtml,
        messageId,
        inReplyTo,
        rules.markRead ?? false,
        rules.star ?? false,
        hasAttachments,
        Buffer.byteLength(bodyHtml, 'utf8'),
        raw.toString('utf8').slice(0, 500_000),
        spamScore,
        JSON.stringify(headersObj),
      ],
    )

    const emailId = rows[0].id

    for (const att of parsed.attachments ?? []) {
      if (!att.content || !att.filename) continue
      const attachmentId = randomUUID()
      const safeName = path.basename(att.filename).replace(/[^\w.\-() ]+/g, '_')
      const domainName = user.domain_id
        ? (
            await client.query<{ domain_name: string }>(
              'SELECT domain_name FROM domains WHERE id = $1',
              [user.domain_id],
            )
          ).rows[0]?.domain_name ?? 'unknown'
        : 'unknown'
      const relativePath = path.join('attachments', domainName, user.id, attachmentId, safeName)
      const absolutePath = path.join(env.MAIL_DATA_DIR, relativePath)
      await mkdir(path.dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, att.content)

      await client.query(
        `INSERT INTO attachments (id, email_id, filename, content_type, size_bytes, storage_path)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          attachmentId,
          emailId,
          safeName,
          att.contentType ?? null,
          att.size,
          relativePath,
        ],
      )
    }

    await client.query('COMMIT')
    notifyMailUpdated(user.id, { folder })
    if (folder === 'inbox') {
      sendNewEmailNotification(user.id, emailId, {
        from_address: fromAddress,
        from_name: fromName,
        subject,
        body_text: bodyText,
      }).catch((err) => console.error('[Telegram] Error sending inbound notification:', err))
    }
    return { delivered: true }

  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
