import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getPool } from './db.service'
import { findUserById } from './auth.service'
import { env } from '../config/env'
import { AppHttpError } from '../utils/appHttpError'
import type { UserSettings } from '../types/settings'

const SALT_ROUNDS = 12

interface SettingsRow {
  email: string
  display_name: string | null
  avatar_url: string | null
  signature_html: string | null
  auto_reply_enabled: boolean
  auto_reply_subject: string | null
  auto_reply_body: string | null
  telegram_username: string | null
  telegram_phone: string | null
  telegram_chat_id: string | null
  telegram_notifications_enabled: boolean
  group_by_contacts: boolean
}

const SETTINGS_COLUMNS = `email, display_name, avatar_url, signature_html,
            auto_reply_enabled, auto_reply_subject, auto_reply_body,
            telegram_username, telegram_phone, telegram_chat_id, telegram_notifications_enabled, group_by_contacts`

function mapSettings(row: SettingsRow): UserSettings {
  return {
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    signature_html: row.signature_html,
    auto_reply_enabled: row.auto_reply_enabled,
    auto_reply_subject: row.auto_reply_subject,
    auto_reply_body: row.auto_reply_body,
    telegram_username: row.telegram_username,
    telegram_phone: row.telegram_phone,
    telegram_chat_id: row.telegram_chat_id,
    telegram_notifications_enabled: row.telegram_notifications_enabled,
    group_by_contacts: row.group_by_contacts,
  }
}

async function fetchBotUsername(): Promise<string | null> {
  try {
    const { rows } = await getPool().query<{ value: string | null }>(
      `SELECT value FROM system_settings WHERE key = 'telegram_bot_username'`,
    )
    return rows[0]?.value || null
  } catch {
    return null
  }
}

async function mapSettingsAsync(row: SettingsRow): Promise<UserSettings> {
  const botUsername = await fetchBotUsername()
  return {
    ...mapSettings(row),
    telegram_bot_username: botUsername,
  }
}

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const { rows } = await getPool().query<SettingsRow>(
    `SELECT ${SETTINGS_COLUMNS}
     FROM users WHERE id = $1`,
    [userId],
  )
  return rows[0] ? mapSettingsAsync(rows[0]) : null
}


export async function updateAvatar(
  userId: string,
  file: Express.Multer.File,
): Promise<UserSettings | null> {
  const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png'
  const fileName = `${randomUUID()}${ext}`
  const relativePath = path.join('avatars', userId, fileName)
  const absolutePath = path.join(env.MAIL_DATA_DIR, relativePath)

  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, file.buffer)

  const avatarUrl = `/api/avatars/${userId}?t=${Date.now()}`
  const { rows } = await getPool().query<SettingsRow>(
    `UPDATE users SET avatar_path = $2, avatar_url = $3, updated_at = NOW()
     WHERE id = $1
     RETURNING ${SETTINGS_COLUMNS}`,
    [userId, relativePath, avatarUrl],
  )
  return rows[0] ? mapSettingsAsync(rows[0]) : null
}

export async function getAvatarFile(
  userId: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const { rows } = await getPool().query<{ avatar_path: string | null }>(
    'SELECT avatar_path FROM users WHERE id = $1',
    [userId],
  )
  const relativePath = rows[0]?.avatar_path
  if (!relativePath) return null

  try {
    const buffer = await readFile(path.join(env.MAIL_DATA_DIR, relativePath))
    const ext = path.extname(relativePath).toLowerCase()
    const contentType =
      ext === '.png'
        ? 'image/png'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/jpeg'
    return { buffer, contentType }
  } catch {
    throw new AppHttpError(404, 'Avatar not found')
  }
}

export async function updateProfile(
  userId: string,
  displayName: string,
): Promise<UserSettings | null> {
  const { rows } = await getPool().query<SettingsRow>(
    `UPDATE users SET display_name = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING ${SETTINGS_COLUMNS}`,
    [userId, displayName.trim() || null],
  )
  return rows[0] ? mapSettingsAsync(rows[0]) : null
}

export async function updateSignature(userId: string, signatureHtml: string): Promise<UserSettings | null> {
  const { rows } = await getPool().query<SettingsRow>(
    `UPDATE users SET signature_html = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING ${SETTINGS_COLUMNS}`,
    [userId, signatureHtml.trim() || null],
  )
  return rows[0] ? mapSettingsAsync(rows[0]) : null
}

export async function updateAutoReply(
  userId: string,
  input: { enabled: boolean; subject?: string; body?: string },
): Promise<UserSettings | null> {
  const { rows } = await getPool().query<SettingsRow>(
    `UPDATE users SET
       auto_reply_enabled = $2,
       auto_reply_subject = $3,
       auto_reply_body = $4,
       updated_at = NOW()
     WHERE id = $1
     RETURNING ${SETTINGS_COLUMNS}`,
    [
      userId,
      input.enabled,
      input.subject?.trim() || null,
      input.body?.trim() || null,
    ],
  )
  return rows[0] ? mapSettingsAsync(rows[0]) : null
}

export async function updateTelegramSettings(
  userId: string,
  input: { username: string | null; phone: string | null; enabled: boolean },
): Promise<UserSettings | null> {
  const { rows } = await getPool().query<SettingsRow>(
    `UPDATE users SET
       telegram_username = $2,
       telegram_phone = $3,
       telegram_notifications_enabled = $4,
       updated_at = NOW()
     WHERE id = $1
     RETURNING ${SETTINGS_COLUMNS}`,
    [
      userId,
      input.username?.trim() || null,
      input.phone?.trim() || null,
      input.enabled,
    ],
  )
  return rows[0] ? mapSettingsAsync(rows[0]) : null
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await findUserById(userId)
  if (!user) throw new Error('User not found')

  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) throw new Error('Current password is incorrect')

  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters')

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await getPool().query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [
    userId,
    hash,
  ])
}

function normalizeForCompare(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Добавляет подпись, только если её текст ещё не встречается в письме — даже если
 * подпись уже присутствует в другом форматировании (например, после переключения
 * редактора в текстовый режим и обратно потеряла разметку). Иначе подпись
 * задваивается, что выглядит как «спам-шаблон» с повторным блоком контактов.
 */
export function appendSignature(bodyHtml: string, signatureHtml: string): string {
  const sig = signatureHtml.trim()
  if (!sig) return bodyHtml

  const normalizedSig = normalizeForCompare(sig)
  if (normalizedSig && normalizeForCompare(bodyHtml).includes(normalizedSig)) {
    return bodyHtml
  }

  return `${bodyHtml}<br/><hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>${sig}`
}

export async function updateGroupByContacts(
  userId: string,
  groupByContacts: boolean,
): Promise<UserSettings | null> {
  const { rows } = await getPool().query<SettingsRow>(
    `UPDATE users SET group_by_contacts = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING ${SETTINGS_COLUMNS}`,
    [userId, groupByContacts],
  )
  return rows[0] ? mapSettingsAsync(rows[0]) : null
}

