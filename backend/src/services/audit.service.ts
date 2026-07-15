import { getPool } from './db.service'
import type { AuditEntry, AdminStats } from '../types/domain'
import { env } from '../config/env'
import { checkDbConnection } from './db.service'
import { getActorDomainScope } from '../utils/domainAccess'

interface LogInput {
  userId: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  details?: Record<string, unknown> | null
  ipAddress?: string | null
}

export async function logAudit(input: LogInput): Promise<void> {
  await getPool().query(
    `INSERT INTO audit_log (user_id, action, target_type, target_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.userId,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      input.details ? JSON.stringify(input.details) : null,
      input.ipAddress ?? null,
    ],
  )
}

export async function getAuditLog(
  userId: string,
  page = 1,
  limit = 50,
): Promise<{ items: AuditEntry[]; total: number; page: number }> {
  const actor = await getActorDomainScope(userId)
  const offset = (page - 1) * limit

  if (actor.isSuperadmin) {
    const [countRes, itemsRes] = await Promise.all([
      getPool().query<{ total: number }>('SELECT COUNT(*)::int AS total FROM audit_log'),
      getPool().query<{
        id: string
        user_id: string | null
        user_email: string | null
        action: string
        target_type: string | null
        target_id: string | null
        details: Record<string, unknown> | null
        ip_address: string | null
        created_at: Date
      }>(
        `SELECT al.id, al.user_id, u.email AS user_email, al.action, al.target_type, al.target_id,
                al.details, al.ip_address::text, al.created_at
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
    ])
    return {
      items: itemsRes.rows.map(mapAudit),
      total: countRes.rows[0]?.total ?? 0,
      page,
    }
  }

  const [countRes, itemsRes] = await Promise.all([
    getPool().query<{ total: number }>(
      'SELECT COUNT(*)::int AS total FROM audit_log WHERE user_id = $1',
      [userId],
    ),
    getPool().query<{
      id: string
      user_id: string | null
      user_email: string | null
      action: string
      target_type: string | null
      target_id: string | null
      details: Record<string, unknown> | null
      ip_address: string | null
      created_at: Date
    }>(
      `SELECT al.id, al.user_id, u.email AS user_email, al.action, al.target_type, al.target_id,
              al.details, al.ip_address::text, al.created_at
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.user_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
  ])

  return {
    items: itemsRes.rows.map(mapAudit),
    total: countRes.rows[0]?.total ?? 0,
    page,
  }
}

function mapAudit(row: {
  id: string
  user_id: string | null
  user_email: string | null
  action: string
  target_type: string | null
  target_id: string | null
  details: Record<string, unknown> | null
  ip_address: string | null
  created_at: Date
}): AuditEntry {
  return {
    id: row.id,
    user_id: row.user_id,
    user_email: row.user_email,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    details: row.details,
    ip_address: row.ip_address,
    created_at: row.created_at.toISOString(),
  }
}

export async function getAdminStats(userId: string): Promise<AdminStats> {
  const actor = await getActorDomainScope(userId)
  const userParams = actor.isSuperadmin ? [] : [actor.domainId]

  const usersQuery = actor.isSuperadmin
    ? 'SELECT COUNT(*)::int AS c FROM users'
    : 'SELECT COUNT(*)::int AS c FROM users WHERE domain_id = $1'
  const domainsQuery = actor.isSuperadmin
    ? `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE is_active)::int AS active,
         COUNT(*) FILTER (WHERE is_verified)::int AS verified
       FROM domains`
    : `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE is_active)::int AS active,
         COUNT(*) FILTER (WHERE is_verified)::int AS verified
       FROM domains WHERE id = $1`
  const emailsQuery = actor.isSuperadmin
    ? 'SELECT COUNT(*)::int AS c, COALESCE(SUM(size_bytes),0)::bigint AS bytes FROM emails'
    : `SELECT COUNT(*)::int AS c, COALESCE(SUM(size_bytes),0)::bigint AS bytes
       FROM emails WHERE user_id IN (SELECT id FROM users WHERE domain_id = $1)`

  const [users, domains, emails] = await Promise.all([
    getPool().query<{ c: number }>(usersQuery, userParams),
    getPool().query<{ total: number; active: number; verified: number }>(domainsQuery, userParams),
    getPool().query<{ c: number; bytes: string }>(emailsQuery, userParams),
  ])

  return {
    total_users: users.rows[0]?.c ?? 0,
    total_domains: domains.rows[0]?.total ?? 0,
    active_domains: domains.rows[0]?.active ?? 0,
    verified_domains: domains.rows[0]?.verified ?? 0,
    total_emails: emails.rows[0]?.c ?? 0,
    storage_used_bytes: Number(emails.rows[0]?.bytes ?? 0),
  }
}

export async function getServerMailConfig(): Promise<{
  server_public_ip: string
  mail_hostname: string | null
  mta_enabled: boolean
  ip_source: 'env' | 'secret_file' | 'default'
}> {
  const ip = env.SERVER_PUBLIC_IP
  let ipSource: 'env' | 'secret_file' | 'default' = 'default'
  if (ip !== '127.0.0.1') {
    ipSource = 'env'
  }
  return {
    server_public_ip: ip,
    mail_hostname: env.MAIL_HOSTNAME ?? null,
    mta_enabled: env.MTA_ENABLED,
    ip_source: ipSource,
  }
}

export async function getDbConfigInfo(): Promise<{
  mode: 'external' | 'local'
  host: string
  port: number
  database: string
  user: string
  connected: boolean
}> {
  const connected = await checkDbConnection()
  return {
    mode: env.DB_MODE,
    host: env.DB_MODE === 'local' ? env.DB_HOST : '(from DATABASE_URL)',
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    connected,
  }
}

export async function testDatabaseConnection(connectionString: string): Promise<boolean> {
  const { Pool } = await import('pg')
  let url = connectionString.trim()
  if (!url.includes('://')) url = `postgresql://${url}`
  const testPool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 })
  try {
    const client = await testPool.connect()
    await client.query('SELECT 1')
    client.release()
    return true
  } catch {
    return false
  } finally {
    await testPool.end()
  }
}

export async function applyDatabaseConfig(connectionString: string): Promise<{
  applied: boolean
  path: string
  message: string
}> {
  const ok = await testDatabaseConnection(connectionString)
  if (!ok) throw new Error('Не удалось подключиться с указанной строкой')

  const configured = process.env.EMAIL_SECRETS_DIR?.trim()
  const target = configured
    ? `${configured}/database_url`
    : process.env.DATABASE_URL_FILE?.trim() || '/opt/email/secret/database_url'

  try {
    const fs = await import('node:fs/promises')
    const pathMod = await import('node:path')
    await fs.mkdir(pathMod.dirname(target), { recursive: true })
    await fs.writeFile(target, `${connectionString.trim()}\n`, { mode: 0o600 })
    return {
      applied: true,
      path: target,
      message: 'Файл database_url обновлён. Перезапустите контейнер backend.',
    }
  } catch {
    return {
      applied: false,
      path: target,
      message: `Нет прав записи в ${target}. Сохраните строку подключения вручную и перезапустите backend.`,
    }
  }
}
