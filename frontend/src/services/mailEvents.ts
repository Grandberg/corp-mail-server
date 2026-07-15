import { useAuthStore } from '@/store/authStore'
import { API_URL } from '@/config/constants'

function parseSseBlock(block: string, onEvent: (event: string) => void): void {
  const trimmed = block.trim()
  if (!trimmed || trimmed.startsWith(':')) return

  let eventName = 'message'
  for (const line of trimmed.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
    }
  }
  onEvent(eventName)
}

/**
 * Подключение к SSE /emails/events (fetch + Authorization, т.к. EventSource не шлёт JWT).
 * Держит соединение открытым, пока не сработает signal.
 */
export async function connectMailEvents(
  onEvent: (event: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${API_URL}/emails/events`, { headers, signal })
  if (!res.ok) {
    throw new Error(`SSE failed: ${res.status}`)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('SSE: empty response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    let separator = buffer.indexOf('\n\n')
    while (separator >= 0) {
      const block = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      parseSseBlock(block, onEvent)
      separator = buffer.indexOf('\n\n')
    }
  }
}
