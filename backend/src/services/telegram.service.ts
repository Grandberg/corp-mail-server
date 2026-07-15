import { getPool } from './db.service'

let botToken: string | null = null
let botUsername: string | null = null
let isPolling = false
let pollAbortController: AbortController | null = null
let lastPollError: string | null = null
let lastPollSuccessAt: Date | null = null

export interface TelegramBotConfig {
  token: string
  username: string
}

/** Получить настройки Telegram бота из базы данных */
export async function getTelegramBotConfig(): Promise<TelegramBotConfig> {
  const { rows } = await getPool().query<{ key: string; value: string | null }>(
    `SELECT key, value FROM system_settings
     WHERE key IN ('telegram_bot_token', 'telegram_bot_username')`
  )
  const config: TelegramBotConfig = { token: '', username: '' }
  for (const row of rows) {
    if (row.key === 'telegram_bot_token') config.token = row.value || ''
    if (row.key === 'telegram_bot_username') config.username = row.value || ''
  }
  return config
}

/** Сохранить настройки Telegram бота в БД и перезапустить бота */
export async function saveTelegramBotConfig(token: string, username: string): Promise<void> {
  const client = await getPool().connect()
  const cleanUsername = username
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@/, '')

  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('telegram_bot_token', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [token.trim()]
    )
    await client.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('telegram_bot_username', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [cleanUsername]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // Перезапуск бота
  await startTelegramBot()
}

/** Запустить Telegram бота */
export async function startTelegramBot(): Promise<void> {
  stopTelegramBot()

  const config = await getTelegramBotConfig()
  if (!config.token) {
    console.log('[Telegram] Токен не настроен, бот не будет запущен.')
    return
  }

  botToken = config.token
  botUsername = config.username
  isPolling = true
  pollAbortController = new AbortController()

  // Удаляем вебхук перед запуском поллинга, чтобы избежать ошибки 409 Conflict
  try {
    const deleteWebhookUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`
    const res = await fetch(deleteWebhookUrl)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.warn(`[Telegram] Предупреждение при удалении вебхука: ${errText}`)
    } else {
      console.log('[Telegram] Вебхук успешно удален (если был активен).')
    }
  } catch (err: any) {
    console.warn(`[Telegram] Не удалось вызвать deleteWebhook: ${err.message}`)
  }

  // Запуск поллинга в фоне
  runPolling().catch((err) => {
    console.error('[Telegram] Ошибка в цикле поллинга:', err)
  })
}

/** Остановить Telegram бота */
export function stopTelegramBot(): void {
  isPolling = false
  if (pollAbortController) {
    pollAbortController.abort()
    pollAbortController = null
  }
}

/** Цикл long polling для получения обновлений от Telegram */
async function runPolling(): Promise<void> {
  let offset = 0
  console.log(`[Telegram] Запуск поллинга обновлений для @${botUsername || 'bot'}...`)

  while (isPolling) {
    try {
      const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=30`
      const res = await fetch(url, {
        signal: pollAbortController?.signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        const errorMsg = `Ошибка getUpdates (status: ${res.status}): ${errText}`
        lastPollError = errorMsg

        if (res.status === 401) {
          console.error('[Telegram] Неверный токен бота (401 Unauthorized). Бот остановлен.')
          isPolling = false
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 5000))
        continue
      }

      const data = (await res.json()) as { ok: boolean; result: Array<{ update_id: number; message?: any }> }
      if (data.ok) {
        lastPollError = null
        lastPollSuccessAt = new Date()
        if (data.result.length > 0) {
          for (const update of data.result) {
            offset = update.update_id + 1
            if (update.message) {
              await handleTelegramMessage(update.message)
            }
          }
        }
      } else {
        lastPollError = 'Telegram API вернул ok: false в getUpdates'
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[Telegram] Поллинг остановлен.')
        break
      }
      lastPollError = err.message
      console.error('[Telegram] Ошибка сетевого соединения при поллинге:', err.message)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
}

/** Обработка входящего сообщения к боту */
async function handleTelegramMessage(message: any): Promise<void> {
  const chatId = message.chat.id
  const text = message.text?.trim()
  const fromUsername = message.from?.username?.toLowerCase()

  if (!text) return

  // 1. Проверяем команду /start с UUID пользователя
  const startMatch = text.match(/^\/start\s+([0-9a-fA-F-]{36})$/)
  if (startMatch) {
    const userId = startMatch[1]
    const client = await getPool().connect()
    try {
      const { rowCount } = await client.query(
        `UPDATE users SET telegram_chat_id = $2, telegram_notifications_enabled = true, updated_at = NOW()
         WHERE id = $1`,
        [userId, String(chatId)]
      )

      if (rowCount && rowCount > 0) {
        const { rows } = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])
        const email = rows[0]?.email || 'ваш ящик'
        await sendTelegramMessage(
          chatId,
          `🎉 Бот успешно подключен к ящику *${email}*!\nУведомления о новых письмах включены.`
        )
      } else {
        await sendTelegramMessage(chatId, `❌ Пользователь с таким ID не найден. Обратитесь к администратору.`)
      }
    } catch (err) {
      console.error('[Telegram] Ошибка сохранения chat_id по UUID:', err)
      await sendTelegramMessage(chatId, `❌ Произошла ошибка при связывании аккаунта.`)
    } finally {
      client.release()
    }
    return
  }

  // 2. Обработка обычного /start
  if (text.startsWith('/start')) {
    await sendTelegramMessage(
      chatId,
      `👋 Привет!\n\nДля подключения уведомлений:\n` +
        `1. Откройте веб-интерфейс почты -> Настройки -> Telegram.\n` +
        `2. Нажмите кнопку "Подключить Telegram" (она перенаправит вас в этот диалог с кодом привязки).\n\n` +
        `Либо укажите ваш Telegram username в настройках веб-интерфейса, а затем напишите боту любое сообщение.`
    )

    if (fromUsername) {
      await tryBindByUsername(fromUsername, chatId)
    }
    return
  }

  // 3. Попытка привязать по username
  if (fromUsername) {
    const bound = await tryBindByUsername(fromUsername, chatId)
    if (bound) return
  }

  await sendTelegramMessage(chatId, `Бот активен. Чтобы настроить уведомления, зайдите в настройки почты в браузере.`)
}

/** Попытка связать chat_id с пользователем по его Telegram username */
async function tryBindByUsername(username: string, chatId: number): Promise<boolean> {
  const client = await getPool().connect()
  try {
    const { rows } = await client.query<{ id: string; email: string; telegram_chat_id: string | null }>(
      `SELECT id, email, telegram_chat_id FROM users
       WHERE LOWER(telegram_username) = LOWER($1) OR LOWER(telegram_username) = LOWER($2)`,
      [username, `@${username}`]
    )

    if (rows.length > 0) {
      const user = rows[0]
      if (user.telegram_chat_id !== String(chatId)) {
        await client.query(
          `UPDATE users SET telegram_chat_id = $2, telegram_notifications_enabled = true, updated_at = NOW()
           WHERE id = $1`,
          [user.id, String(chatId)]
        )
        await sendTelegramMessage(
          chatId,
          `🎉 Бот успешно подключен к ящику *${user.email}*!\nУведомления о новых письмах включены.`
        )
      }
      return true
    }
  } catch (err) {
    console.error('[Telegram] Ошибка связывания по username:', err)
  } finally {
    client.release()
  }
  return false
}

/** Отправка произвольного сообщения в Telegram чат, возвращает ID сообщения */
export async function sendTelegramMessage(chatId: string | number, text: string): Promise<number | null> {
  if (!botToken) return null
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        text,
        parse_mode: 'Markdown',
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[Telegram] Ошибка при вызове sendMessage (status: ${res.status}): ${errText}`)
      return null
    }
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number } }
    return data.result?.message_id || null
  } catch (err) {
    console.error('[Telegram] Ошибка при вызове sendMessage:', err)
    return null
  }
}

/** Экранирование спецсимволов для Telegram Markdown */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*`\[\]()]/g, '\\$&')
}

/** Отправка уведомления о новом входящем письме */
export async function sendNewEmailNotification(
  userId: string,
  emailId: string,
  email: { from_address: string; from_name: string | null; subject: string; body_text: string }
): Promise<void> {
  try {
    const { rows } = await getPool().query<{
      email: string
      telegram_chat_id: string | null
      telegram_notifications_enabled: boolean
    }>(
      `SELECT email, telegram_chat_id, telegram_notifications_enabled FROM users
       WHERE id = $1`,
      [userId]
    )

    const user = rows[0]
    if (!user || !user.telegram_chat_id || !user.telegram_notifications_enabled) {
      return
    }

    const fromDisplay = email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address
    const subjectDisplay = email.subject || '(без темы)'

    const bodyText = email.body_text || ''
    const bodySnippet = bodyText.length > 200 ? bodyText.slice(0, 200) + '...' : bodyText

    const text =
      `📬 *Новое письмо для ${escapeMarkdown(user.email)}*\n\n` +
      `*От:* ${escapeMarkdown(fromDisplay)}\n` +
      `*Тема:* ${escapeMarkdown(subjectDisplay)}\n\n` +
      `${escapeMarkdown(bodySnippet)}`

    const tgMsgId = await sendTelegramMessage(user.telegram_chat_id, text)
    if (tgMsgId) {
      await getPool().query(
        `UPDATE emails SET telegram_message_id = $2 WHERE id = $1`,
        [emailId, String(tgMsgId)]
      )
    }
  } catch (err) {
    console.error('[Telegram] Ошибка при отправке уведомления о письме:', err)
  }
}

/** Удалить уведомление из Telegram при прочтении письма */
export async function deleteTelegramNotification(userId: string, emailId: string): Promise<void> {
  if (!botToken) return
  try {
    const { rows } = await getPool().query<{
      telegram_chat_id: string | null
      telegram_message_id: string | null
    }>(
      `SELECT u.telegram_chat_id, e.telegram_message_id
       FROM emails e
       JOIN users u ON u.id = e.user_id
       WHERE e.id = $1 AND e.user_id = $2`,
      [emailId, userId]
    )

    const row = rows[0]
    if (!row || !row.telegram_chat_id || !row.telegram_message_id) {
      return
    }

    const url = `https://api.telegram.org/bot${botToken}/deleteMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: row.telegram_chat_id,
        message_id: Number(row.telegram_message_id),
      }),
    })

    if (res.ok || res.status === 400) {
      await getPool().query(
        `UPDATE emails SET telegram_message_id = NULL WHERE id = $1`,
        [emailId]
      )
    }
  } catch (err) {
    console.error('[Telegram] Ошибка при удалении сообщения:', err)
  }
}

/** Отправка тестового уведомления */
export async function sendTestNotification(userId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ telegram_chat_id: string | null }>(
    `SELECT telegram_chat_id FROM users WHERE id = $1`,
    [userId]
  )
  const user = rows[0]
  if (!user || !user.telegram_chat_id) {
    throw new Error('Telegram бот не подключен для вашего аккаунта')
  }
  const tgMsgId = await sendTelegramMessage(
    user.telegram_chat_id,
    `🔔 *Тестовое уведомление*\n\nЕсли вы видите это сообщение, значит уведомления о новых письмах настроены верно!`
  )
  return tgMsgId !== null
}

/** Проверить работоспособность токена бота и доступность Telegram API */
export async function validateTelegramBotToken(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const url = `https://api.telegram.org/bot${token.trim()}/getMe`
    const res = await fetch(url)
    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, error: 'Неверный токен бота (401 Unauthorized)' }
      }
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Ошибка Telegram API (status: ${res.status}): ${text}` }
    }
    const data = (await res.json()) as { ok: boolean; result?: { username: string } }
    if (data.ok && data.result) {
      return { ok: true, username: data.result.username }
    }
    return { ok: false, error: 'Не удалось получить имя бота из ответа' }
  } catch (err: any) {
    return { ok: false, error: `Ошибка сетевого соединения с Telegram API: ${err.message}` }
  }
}

export interface TelegramBotStatus {
  isPolling: boolean
  botUsername: string | null
  lastPollError: string | null
  lastPollSuccessAt: string | null
}

export function getTelegramBotStatus(): TelegramBotStatus {
  return {
    isPolling,
    botUsername,
    lastPollError,
    lastPollSuccessAt: lastPollSuccessAt ? lastPollSuccessAt.toISOString() : null,
  }
}
