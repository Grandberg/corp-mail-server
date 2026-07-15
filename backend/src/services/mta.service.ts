import nodemailer from 'nodemailer'
import type Mail from 'nodemailer/lib/mailer'
import { env } from '../config/env'
import type { EmailAddress } from '../types/email'
import { htmlToText } from '../utils/htmlToText'
import { wrapHtmlForMail } from '../utils/mailHtml'
import { detectMailLanguage } from '../utils/mailLanguage'
import { getAttachmentBuffersByIds } from './attachment.service'

let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.HARAKA_HOST,
      port: env.HARAKA_SUBMISSION_PORT,
      secure: false,
      // requireTLS: без него STARTTLS на этом хопе был чисто опциональным — если Haraka
      // по какой-то причине не предложит STARTTLS (баг конфига, рестарт TLS-плагина и т.п.),
      // nodemailer тихо отправил бы письмо в открытом виде по internal-сети email_net.
      // rejectUnauthorized:false оставлен — сертификат Haraka выписан на mail.inoxsigns.com,
      // а сюда мы подключаемся по имени контейнера (email_haraka), поэтому проверка цепочки/
      // hostname здесь заведомо не пройдёт; шифрование канала при этом всё равно обязательно.
      requireTLS: true,
      tls: { rejectUnauthorized: false },
      // Без этого nodemailer подставляет os.hostname() контейнера (внутри Docker
      // резолвится в 127.0.0.1), из-за чего в цепочке Received появляется явное
      // рассогласование EHLO/фактического хоста — сигнал для антиспам-фильтров.
      // MAIL_HOSTNAME — тот же хост, что должен совпадать с rDNS сервера (см. dns.service.ts).
      name: env.MAIL_HOSTNAME || 'localhost',
    })
  }
  return transporter
}

export function isMtaConfigured(): boolean {
  return env.MTA_ENABLED
}

export async function sendExternalMail(input: {
  from: string
  fromName: string | null
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  subject: string
  html: string
  messageId: string
  inReplyTo?: string | null
  references?: string[]
  attachmentIds: string[]
  isPlainText?: boolean
}): Promise<void> {
  if (!env.MTA_ENABLED) {
    throw new Error('MTA is not enabled')
  }

  const attachments = await getAttachmentBuffersByIds(input.attachmentIds)
  const plain = htmlToText(input.html)
  const lang = detectMailLanguage(`${input.subject} ${plain}`)

  const headers: Record<string, string> = {}
  if (lang) headers['Content-Language'] = lang

  let mailHtml: string | undefined = undefined
  let mailText: string = plain || input.subject

  if (!input.isPlainText) {
    mailHtml = wrapHtmlForMail(input.html, lang)
    mailText = htmlToText(mailHtml) || input.subject
  }

  const mail: Mail.Options = {
    from: input.fromName ? `${input.fromName} <${input.from}>` : input.from,
    to: input.to.map(formatAddress),
    cc: input.cc.length ? input.cc.map(formatAddress) : undefined,
    bcc: input.bcc.length ? input.bcc.map(formatAddress) : undefined,
    subject: input.subject,
    text: mailText,
    html: mailHtml,
    messageId: input.messageId,
    inReplyTo: input.inReplyTo ?? undefined,
    references: input.references?.length ? input.references : undefined,
    headers,
    attachments: attachments.map((a) => ({
      filename: a.filename,
      content: a.buffer,
      contentType: a.content_type ?? undefined,
    })),
  }

  await getTransporter().sendMail(mail)
}

function formatAddress(addr: EmailAddress): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email
}

export async function checkMtaConnection(): Promise<boolean> {
  if (!env.MTA_ENABLED) return false
  try {
    await getTransporter().verify()
    return true
  } catch {
    return false
  }
}
