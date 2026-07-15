import { randomBytes } from 'node:crypto'
import type { EmailAddress } from '../types/email'
import { htmlToText } from './htmlToText'

function formatRfc2822Date(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} +0000`
  )
}

function formatAddress(addr: EmailAddress): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email
}

function formatAddressList(list: EmailAddress[]): string {
  return list.map(formatAddress).join(', ')
}

function encodeBase64Body(text: string): string {
  const base64 = Buffer.from(text, 'utf8').toString('base64')
  const lines: string[] = []
  for (let i = 0; i < base64.length; i += 76) {
    lines.push(base64.slice(i, i + 76))
  }
  return lines.join('\r\n')
}

function foldHeader(name: string, value: string): string {
  return `${name}: ${value}`
}

export interface RawEmailInput {
  messageId: string
  date: Date
  from: EmailAddress
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  subject: string
  bodyHtml: string
  inReplyTo?: string | null
  references?: string[]
  attachments?: Array<{ filename: string; size_bytes: number }>
  isPlainText?: boolean
}

/**
 * Полное сырое письмо (RFC 5322) для собственной копии («Отправленные» / входящая
 * копия внутреннего получателя). Заголовки транзитных серверов (Received от Haraka,
 * DKIM-подпись) добавляются позже, за пределами backend, при реальной пересылке —
 * здесь фиксируется всё, что известно на момент отправки.
 */
export function buildRawEmail(input: RawEmailInput): string {
  const boundary = `----_corpmail-${randomBytes(12).toString('hex')}`
  const headers: string[] = []

  headers.push(foldHeader('Return-Path', `<${input.from.email}>`))
  headers.push(foldHeader('Date', formatRfc2822Date(input.date)))
  headers.push(foldHeader('From', formatAddress(input.from)))
  headers.push(foldHeader('To', formatAddressList(input.to)))
  if (input.cc?.length) headers.push(foldHeader('Cc', formatAddressList(input.cc)))
  if (input.bcc?.length) headers.push(foldHeader('Bcc', formatAddressList(input.bcc)))
  headers.push(foldHeader('Subject', input.subject))
  headers.push(foldHeader('Message-ID', input.messageId))
  if (input.inReplyTo) headers.push(foldHeader('In-Reply-To', input.inReplyTo))
  if (input.references?.length) headers.push(foldHeader('References', input.references.join(' ')))
  headers.push(foldHeader('MIME-Version', '1.0'))
  headers.push(foldHeader('X-Mailer', 'Corporate Mail'))
  if (input.attachments?.length) {
    const list = input.attachments
      .map((a) => `${a.filename} (${Math.ceil(a.size_bytes / 1024)} KB)`)
      .join(', ')
    headers.push(foldHeader('X-Attachments', list))
  }

  if (input.isPlainText) {
    headers.push(foldHeader('Content-Type', 'text/plain; charset=utf-8'))
    headers.push(foldHeader('Content-Transfer-Encoding', 'base64'))
    const text = htmlToText(input.bodyHtml)
    return `${headers.join('\r\n')}\r\n\r\n${encodeBase64Body(text || input.subject)}`
  }

  headers.push(foldHeader('Content-Type', `multipart/alternative; boundary="${boundary}"`))

  const text = htmlToText(input.bodyHtml)

  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBase64Body(text || input.subject),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBase64Body(input.bodyHtml),
    '',
    `--${boundary}--`,
  ]

  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`
}
