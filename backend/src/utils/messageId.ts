import { randomUUID } from 'node:crypto'
import { extractDomainFromEmail } from './emailDomain'

/** Message-ID в домене отправителя (нужно для DMARC alignment и доверия получателей). */
export function buildMessageId(senderEmail: string, prefix?: string): string {
  const domain = extractDomainFromEmail(senderEmail) ?? 'localhost'
  const id = randomUUID()
  if (prefix) return `<${prefix}-${id}@${domain}>`
  return `<${id}@${domain}>`
}
