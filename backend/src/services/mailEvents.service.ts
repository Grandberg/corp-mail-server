import type { Response } from 'express'

interface SseClient {
  userId: string
  res: Response
  heartbeat: ReturnType<typeof setInterval>
}

const clients = new Set<SseClient>()

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** Подключение клиента к потоку событий почты (SSE). */
export function subscribeMailEvents(userId: string, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')
  res.flushHeaders?.()

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* connection closed */
    }
  }, 25_000)

  const client: SseClient = { userId, res, heartbeat }
  clients.add(client)

  res.on('close', () => {
    clearInterval(heartbeat)
    clients.delete(client)
  })
}

export interface MailUpdatedPayload {
  folder?: string
}

/** Уведомить открытые вкладки пользователя об изменении почтового ящика. */
export function notifyMailUpdated(userId: string, payload: MailUpdatedPayload = {}): void {
  for (const client of clients) {
    if (client.userId !== userId) continue
    try {
      writeSse(client.res, 'mail_updated', payload)
    } catch {
      clients.delete(client)
      clearInterval(client.heartbeat)
    }
  }
}

export function notifyMailUpdatedMany(userIds: Iterable<string>, payload: MailUpdatedPayload = {}): void {
  const seen = new Set<string>()
  for (const userId of userIds) {
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    notifyMailUpdated(userId, payload)
  }
}
