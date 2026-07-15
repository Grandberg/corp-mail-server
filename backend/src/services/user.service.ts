import type { Request } from 'express'
import bcrypt from 'bcryptjs'
import { getPool } from './db.service'
import type { AdminUserListItem, UserRecord } from '../types/user'
import { toAdminUserListItem } from '../types/user'
import type { UserRole } from '../config/constants'
import { canAccessDomain, getActorDomainScope } from '../utils/domainAccess'
import { extractDomainFromEmail } from '../utils/emailDomain'
import { logAudit } from './audit.service'
import { AppHttpError } from '../utils/appHttpError'

const SALT_ROUNDS = 12

interface UserStatsRow extends UserRecord {
  unread_count: number
  total_emails: number
  mailbox_size_bytes: string
}

const USER_SELECT = `u.id, u.email, u.password_hash, u.display_name, u.avatar_url, u.domain_id, u.role, u.is_active, u.created_at`

const MAILBOX_STATS_JOIN = `
  LEFT JOIN (
    SELECT user_id,
           COUNT(*) FILTER (WHERE NOT is_read)::int AS unread_count,
           COUNT(*)::int AS total_emails,
           COALESCE(SUM(size_bytes), 0)::bigint AS mailbox_size_bytes
    FROM emails
    GROUP BY user_id
  ) ms ON ms.user_id = u.id`

function mapUserRows(rows: UserStatsRow[]): AdminUserListItem[] {
  return rows.map((row) =>
    toAdminUserListItem(row, {
      unread_count: row.unread_count ?? 0,
      total_emails: row.total_emails ?? 0,
      mailbox_size_bytes: Number(row.mailbox_size_bytes ?? 0),
    }),
  )
}

export async function listUsers(userId: string, domainId?: string): Promise<AdminUserListItem[]> {
  const actor = await getActorDomainScope(userId)

  let filterDomainId = domainId
  if (!actor.isSuperadmin) {
    filterDomainId = actor.domainId ?? undefined
    if (!filterDomainId) return []
    if (domainId && domainId !== filterDomainId) return []
  }

  const { rows } = filterDomainId
    ? await getPool().query<UserStatsRow>(
        `SELECT ${USER_SELECT},
                COALESCE(ms.unread_count, 0)::int AS unread_count,
                COALESCE(ms.total_emails, 0)::int AS total_emails,
                COALESCE(ms.mailbox_size_bytes, 0)::text AS mailbox_size_bytes
         FROM users u
         ${MAILBOX_STATS_JOIN}
         WHERE u.domain_id = $1
         ORDER BY u.email`,
        [filterDomainId],
      )
    : await getPool().query<UserStatsRow>(
        `SELECT ${USER_SELECT},
                COALESCE(ms.unread_count, 0)::int AS unread_count,
                COALESCE(ms.total_emails, 0)::int AS total_emails,
                COALESCE(ms.mailbox_size_bytes, 0)::text AS mailbox_size_bytes
         FROM users u
         ${MAILBOX_STATS_JOIN}
         ORDER BY u.email`,
      )

  return mapUserRows(rows)
}

async function resolveDomainForEmail(emailDomain: string): Promise<{ id: string; domain_name: string }> {
  const { rows } = await getPool().query<{ id: string; domain_name: string }>(
    'SELECT id, domain_name FROM domains WHERE LOWER(domain_name) = LOWER($1) LIMIT 1',
    [emailDomain],
  )
  if (!rows[0]) {
    throw new AppHttpError(400, `Домен ${emailDomain} не подключён к серверу`)
  }
  return rows[0]
}

export async function createDomainUser(
  actorId: string,
  input: {
    email: string
    password: string
    displayName?: string
    role?: UserRole
    domainId: string
  },
  req?: Request,
): Promise<AdminUserListItem> {
  const actor = await getActorDomainScope(actorId)

  const email = input.email.trim().toLowerCase()
  const emailDomain = extractDomainFromEmail(email)
  if (!emailDomain) {
    throw new AppHttpError(400, 'Некорректный email')
  }

  const domain = await resolveDomainForEmail(emailDomain)
  if (!canAccessDomain(actor, domain.id)) {
    throw new AppHttpError(403, 'Forbidden')
  }
  if (input.domainId && input.domainId !== domain.id) {
    throw new AppHttpError(
      400,
      `Email относится к домену ${domain.domain_name}, а выбран другой домен`,
    )
  }
  if (!actor.isSuperadmin && input.role === 'superadmin') {
    throw new AppHttpError(403, 'Cannot assign superadmin role')
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS)
  const role: UserRole = input.role ?? 'user'

  const { rows } = await getPool().query<UserRecord>(
    `INSERT INTO users (email, password_hash, display_name, domain_id, role, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id, email, password_hash, display_name, avatar_url, domain_id, role, is_active, created_at`,
    [email, passwordHash, input.displayName?.trim() || null, domain.id, role],
  )

  await logAudit({
    userId: actorId,
    action: 'user_create',
    targetType: 'user',
    targetId: rows[0].id,
    details: { email, role, domain_id: domain.id },
    ipAddress: getIp(req),
  })

  return toAdminUserListItem(rows[0], {
    unread_count: 0,
    total_emails: 0,
    mailbox_size_bytes: 0,
  })
}

export async function updateDomainUser(
  actorId: string,
  targetUserId: string,
  patch: {
    displayName?: string | null
    role?: UserRole
    isActive?: boolean
    password?: string
  },
  req?: Request,
): Promise<AdminUserListItem | null> {
  const target = await findUserRecord(targetUserId)
  if (!target) return null

  const actor = await getActorDomainScope(actorId)
  if (!target.domain_id || !canAccessDomain(actor, target.domain_id)) {
    throw new AppHttpError(403, 'Forbidden')
  }
  if (!actor.isSuperadmin && patch.role === 'superadmin') {
    throw new AppHttpError(403, 'Cannot assign superadmin role')
  }

  const sets: string[] = []
  const params: unknown[] = [targetUserId]

  if (patch.displayName !== undefined) {
    params.push(patch.displayName)
    sets.push(`display_name = $${params.length}`)
  }
  if (patch.role !== undefined) {
    params.push(patch.role)
    sets.push(`role = $${params.length}`)
  }
  if (patch.isActive !== undefined) {
    params.push(patch.isActive)
    sets.push(`is_active = $${params.length}`)
  }
  if (patch.password) {
    params.push(await bcrypt.hash(patch.password, SALT_ROUNDS))
    sets.push(`password_hash = $${params.length}`)
  }

  if (sets.length === 0) {
    return fetchUserWithStats(targetUserId)
  }

  sets.push('updated_at = NOW()')
  const { rows } = await getPool().query<UserRecord>(
    `UPDATE users SET ${sets.join(', ')}
     WHERE id = $1
     RETURNING id, email, password_hash, display_name, avatar_url, domain_id, role, is_active, created_at`,
    params,
  )

  await logAudit({
    userId: actorId,
    action: 'user_update',
    targetType: 'user',
    targetId: targetUserId,
    details: { ...patch, password: patch.password ? '[changed]' : undefined },
    ipAddress: getIp(req),
  })

  return rows[0] ? fetchUserWithStats(rows[0].id) : null
}

export async function deleteDomainUser(
  actorId: string,
  targetUserId: string,
  req?: Request,
): Promise<boolean> {
  const target = await findUserRecord(targetUserId)
  if (!target) return false

  const actor = await getActorDomainScope(actorId)
  if (!target.domain_id || !canAccessDomain(actor, target.domain_id)) {
    throw new AppHttpError(403, 'Forbidden')
  }
  if (target.id === actorId) {
    throw new AppHttpError(400, 'Cannot delete yourself')
  }

  const { rowCount } = await getPool().query(
    'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1',
    [targetUserId],
  )

  await logAudit({
    userId: actorId,
    action: 'user_deactivate',
    targetType: 'user',
    targetId: targetUserId,
    ipAddress: getIp(req),
  })

  return (rowCount ?? 0) > 0
}

async function findUserRecord(id: string): Promise<UserRecord | null> {
  const { rows } = await getPool().query<UserRecord>(
    `SELECT id, email, password_hash, display_name, avatar_url, domain_id, role, is_active, created_at
     FROM users WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

async function fetchUserWithStats(userId: string): Promise<AdminUserListItem | null> {
  const { rows } = await getPool().query<UserStatsRow>(
    `SELECT ${USER_SELECT},
            COALESCE(ms.unread_count, 0)::int AS unread_count,
            COALESCE(ms.total_emails, 0)::int AS total_emails,
            COALESCE(ms.mailbox_size_bytes, 0)::text AS mailbox_size_bytes
     FROM users u
     ${MAILBOX_STATS_JOIN}
     WHERE u.id = $1`,
    [userId],
  )
  return rows[0] ? mapUserRows(rows)[0] : null
}

function getIp(req?: Request): string | null {
  if (!req) return null
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? null
  return req.ip ?? null
}
