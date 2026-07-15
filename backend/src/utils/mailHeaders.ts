import type { EmailDetail } from '../types/email'

/** Цепочка Message-ID для заголовка References (старые → новые). */
export function buildReferencesHeader(messages: Pick<EmailDetail, 'message_id'>[]): string[] {
  const seen = new Set<string>()
  const refs: string[] = []
  for (const msg of messages) {
    const id = msg.message_id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    refs.push(id)
  }
  return refs
}
