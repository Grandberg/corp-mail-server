import { Queue, Worker } from 'bullmq'
import { env } from '../config/env'
import { getPool } from './db.service'

const QUEUE_NAME = 'email-schedule-queue'

let queue: Queue | null = null
const inMemoryTimers = new Map<string, NodeJS.Timeout>()

const connectionConfig = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Обязательно для BullMQ
}

/** Инициализировать планировщик задач */
export async function initScheduler(): Promise<void> {
  const isRedisConfigured = !!env.REDIS_PASSWORD

  if (isRedisConfigured) {
    try {
      console.log('[Scheduler] Инициализация BullMQ на базе Redis...')
      queue = new Queue(QUEUE_NAME, { connection: connectionConfig })

      new Worker(
        QUEUE_NAME,
        async (job) => {
          const { emailId } = job.data as { emailId: string }
          console.log(`[Scheduler] Очередь: Обработка отправки письма ${emailId}...`)
          const { sendScheduledEmail } = await import('./email.service')
          try {
            const success = await sendScheduledEmail(emailId)
            if (success) {
              console.log(`[Scheduler] Очередь: Письмо ${emailId} успешно отправлено.`)
            } else {
              console.log(`[Scheduler] Очередь: Письмо ${emailId} не было отправлено (возможно, оно уже не актуально).`)
            }
          } catch (err: any) {
            console.error(`[Scheduler] Очередь: Ошибка при отправке письма ${emailId}:`, err.message)
            throw err
          }
        },
        { connection: connectionConfig }
      )

      console.log('[Scheduler] BullMQ Scheduler успешно запущен.')
      return
    } catch (err: any) {
      console.error('[Scheduler] Не удалось запустить BullMQ Scheduler:', err.message)
      console.log('[Scheduler] Переключение на in-memory fallback планировщик...')
    }
  }

  // Fallback режим (in-memory таймеры)
  console.log('[Scheduler] Инициализация in-memory планировщика...')
  await syncInMemoryTimers()
}

/** Синхронизация таймеров в памяти с базой данных при старте */
async function syncInMemoryTimers(): Promise<void> {
  try {
    const { rows } = await getPool().query<{ id: string; scheduled_at: Date }>(
      `SELECT id, scheduled_at FROM emails
       WHERE folder = 'scheduled' AND scheduled_at IS NOT NULL`
    )
    console.log(`[Scheduler] Найдено ${rows.length} запланированных писем в БД для инициализации таймеров.`)
    for (const row of rows) {
      scheduleInMemory(row.id, row.scheduled_at)
    }
  } catch (err: any) {
    console.error('[Scheduler] Ошибка при синхронизации in-memory таймеров:', err.message)
  }
}

/** Запланировать отправку письма в памяти */
function scheduleInMemory(emailId: string, sendAt: Date): void {
  const oldTimeout = inMemoryTimers.get(emailId)
  if (oldTimeout) {
    clearTimeout(oldTimeout)
  }

  const delay = sendAt.getTime() - Date.now()
  const safeDelay = Math.max(10, delay)

  const timer = setTimeout(async () => {
    inMemoryTimers.delete(emailId)
    console.log(`[Scheduler] In-Memory: Отправка письма ${emailId}...`)
    try {
      const { sendScheduledEmail } = await import('./email.service')
      await sendScheduledEmail(emailId)
      console.log(`[Scheduler] In-Memory: Письмо ${emailId} успешно отправлено.`)
    } catch (err: any) {
      console.error(`[Scheduler] In-Memory: Ошибка при отправке письма ${emailId}:`, err.message)
    }
  }, safeDelay)

  inMemoryTimers.set(emailId, timer)
}

/** Запланировать письмо в очередь */
export async function scheduleEmail(emailId: string, sendAt: Date): Promise<void> {
  await cancelScheduledEmail(emailId)

  if (queue) {
    const delay = sendAt.getTime() - Date.now()
    const safeDelay = Math.max(0, delay)
    await queue.add(
      'send-email',
      { emailId },
      { delay: safeDelay, jobId: emailId, removeOnComplete: true, removeOnFail: true }
    )
    console.log(`[Scheduler] Запланирована отправка письма ${emailId} через Redis (задержка: ${safeDelay}мс)`)
  } else {
    scheduleInMemory(emailId, sendAt)
    console.log(`[Scheduler] Запланирована отправка письма ${emailId} в памяти (задержка: ${sendAt.getTime() - Date.now()}мс)`)
  }
}

/** Отменить отправку письма */
export async function cancelScheduledEmail(emailId: string): Promise<void> {
  if (queue) {
    try {
      const job = await queue.getJob(emailId)
      if (job) {
        await job.remove()
        console.log(`[Scheduler] Отменена отправка письма ${emailId} в Redis`)
      }
    } catch (err: any) {
      console.error(`[Scheduler] Ошибка при отмене задачи в Redis для письма ${emailId}:`, err.message)
    }
  } else {
    const timer = inMemoryTimers.get(emailId)
    if (timer) {
      clearTimeout(timer)
      inMemoryTimers.delete(emailId)
      console.log(`[Scheduler] Отменена отправка письма ${emailId} в памяти`)
    }
  }
}
