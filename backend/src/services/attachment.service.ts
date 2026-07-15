import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { env } from '../config/env'
import { getPool } from './db.service'
import type { AttachmentMeta } from '../types/email'
import { findUserById } from './auth.service'
import { buildStorageFilename, sanitizeDisplayFilename } from '../utils/filename'

interface AttachmentRow {
  id: string
  email_id: string | null
  owner_id: string | null
  filename: string
  content_type: string | null
  size_bytes: number
  storage_path: string
  content_id: string | null
  created_at: Date
}

function toAttachmentMeta(row: AttachmentRow): AttachmentMeta {
  return {
    id: row.id,
    email_id: row.email_id,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    content_id: row.content_id,
    created_at: row.created_at.toISOString(),
  }
}

async function resolveDomainName(userId: string): Promise<string> {
  const user = await findUserById(userId)
  if (!user?.domain_id) return 'unknown'
  const { rows } = await getPool().query<{ domain_name: string }>(
    'SELECT domain_name FROM domains WHERE id = $1',
    [user.domain_id],
  )
  return rows[0]?.domain_name ?? 'unknown'
}

export async function saveUploadedAttachment(
  userId: string,
  file: Express.Multer.File,
): Promise<AttachmentMeta> {
  const domainName = await resolveDomainName(userId)
  const attachmentId = randomUUID()
  const displayName = sanitizeDisplayFilename(file.originalname)
  const diskName = buildStorageFilename(attachmentId, displayName)
  const relativePath = path.join('attachments', domainName, userId, attachmentId, diskName)
  const absolutePath = path.join(env.MAIL_DATA_DIR, relativePath)

  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, file.buffer)

  const { rows } = await getPool().query<AttachmentRow>(
    `INSERT INTO attachments (id, owner_id, email_id, filename, content_type, size_bytes, storage_path)
     VALUES ($1, $2, NULL, $3, $4, $5, $6)
     RETURNING id, email_id, owner_id, filename, content_type, size_bytes, storage_path, content_id, created_at`,
    [attachmentId, userId, displayName, file.mimetype || null, file.size, relativePath],
  )

  return toAttachmentMeta(rows[0])
}

export async function getAttachmentForUser(
  userId: string,
  attachmentId: string,
): Promise<{ meta: AttachmentMeta; buffer: Buffer } | null> {
  const { rows } = await getPool().query<AttachmentRow>(
    `SELECT a.id, a.email_id, a.owner_id, a.filename, a.content_type, a.size_bytes,
            a.storage_path, a.content_id, a.created_at
     FROM attachments a
     LEFT JOIN emails e ON e.id = a.email_id
     WHERE a.id = $1 AND (a.owner_id = $2 OR e.user_id = $2)
     LIMIT 1`,
    [attachmentId, userId],
  )
  const row = rows[0]
  if (!row) return null

  const absolutePath = path.join(env.MAIL_DATA_DIR, row.storage_path)
  const buffer = await readFile(absolutePath)
  return { meta: toAttachmentMeta(row), buffer }
}

export async function linkAttachmentsToEmail(
  userId: string,
  emailId: string,
  attachmentIds: string[],
): Promise<void> {
  if (attachmentIds.length === 0) return

  const { rows } = await getPool().query<{ id: string }>(
    'SELECT id FROM emails WHERE id = $1 AND user_id = $2',
    [emailId, userId],
  )
  if (!rows[0]) {
    throw new Error('Email not found')
  }

  await getPool().query(
    `UPDATE attachments
     SET email_id = $3
     WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND (email_id IS NULL OR email_id = $3)`,
    [userId, attachmentIds, emailId],
  )
}

export async function getAttachmentMetaByIds(
  attachmentIds: string[],
): Promise<Array<{ filename: string; size_bytes: number }>> {
  if (attachmentIds.length === 0) return []
  const { rows } = await getPool().query<{ filename: string; size_bytes: number }>(
    'SELECT filename, size_bytes FROM attachments WHERE id = ANY($1::uuid[])',
    [attachmentIds],
  )
  return rows
}

export async function getAttachmentsForEmail(emailId: string): Promise<AttachmentMeta[]> {
  const { rows } = await getPool().query<AttachmentRow>(
    `SELECT id, email_id, owner_id, filename, content_type, size_bytes, storage_path, content_id, created_at
     FROM attachments WHERE email_id = $1 ORDER BY created_at`,
    [emailId],
  )
  return rows.map(toAttachmentMeta)
}

export async function getAttachmentBuffersByIds(
  attachmentIds: string[],
): Promise<Array<{ filename: string; content_type: string | null; buffer: Buffer }>> {
  if (attachmentIds.length === 0) return []

  const { rows } = await getPool().query<AttachmentRow>(
    `SELECT filename, content_type, storage_path
     FROM attachments WHERE id = ANY($1::uuid[])`,
    [attachmentIds],
  )

  const result: Array<{ filename: string; content_type: string | null; buffer: Buffer }> = []
  for (const row of rows) {
    const buffer = await readFile(path.join(env.MAIL_DATA_DIR, row.storage_path))
    result.push({ filename: row.filename, content_type: row.content_type, buffer })
  }
  return result
}
