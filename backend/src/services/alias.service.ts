import type { Request } from 'express'
import { getPool } from './db.service'
import type { Alias } from '../types/domain'
import { canAccessDomain, getActorDomainScope } from '../utils/domainAccess'
import { logAudit } from './audit.service'

interface AliasRow {
  id: string
  domain_id: string
  source_address: string
  destination_user_id: string
  destination_email: string
  is_active: boolean
  created_at: Date
}

function mapAlias(row: AliasRow): Alias {
  return {
    id: row.id,
    domain_id: row.domain_id,
    source_address: row.source_address,
    destination_user_id: row.destination_user_id,
    destination_email: row.destination_email,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
  }
}

export async function listAliases(userId: string, domainId?: string): Promise<Alias[]> {
  const actor = await getActorDomainScope(userId)
  let filterDomainId = domainId
  if (!actor.isSuperadmin) {
    filterDomainId = actor.domainId ?? undefined
    if (!filterDomainId) return []
  }

  const query = `
    SELECT a.id, a.domain_id, a.source_address, a.destination_user_id, a.is_active, a.created_at,
           u.email AS destination_email
    FROM aliases a
    JOIN users u ON u.id = a.destination_user_id
    ${filterDomainId ? 'WHERE a.domain_id = $1' : ''}
    ORDER BY a.source_address
  `
  const { rows } = filterDomainId
    ? await getPool().query<AliasRow>(query, [filterDomainId])
    : await getPool().query<AliasRow>(query)

  return rows.map(mapAlias)
}

export async function createAlias(
  actorId: string,
  input: { sourceAddress: string; destinationUserId: string; domainId: string },
  req?: Request,
): Promise<Alias> {
  const actor = await getActorDomainScope(actorId)
  if (!canAccessDomain(actor, input.domainId)) throw new Error('Forbidden')

  const source = input.sourceAddress.trim().toLowerCase()
  const { rows } = await getPool().query<AliasRow>(
    `INSERT INTO aliases (domain_id, source_address, destination_user_id, is_active)
     VALUES ($1, $2, $3, true)
     RETURNING id, domain_id, source_address, destination_user_id, is_active, created_at,
       ''::text AS destination_email`,
    [input.domainId, source, input.destinationUserId],
  )

  const full = await getPool().query<AliasRow>(
    `SELECT a.id, a.domain_id, a.source_address, a.destination_user_id, a.is_active, a.created_at,
            u.email AS destination_email
     FROM aliases a
     JOIN users u ON u.id = a.destination_user_id
     WHERE a.id = $1`,
    [rows[0].id],
  )

  await logAudit({
    userId: actorId,
    action: 'alias_create',
    targetType: 'alias',
    targetId: rows[0].id,
    details: { source_address: source },
    ipAddress: getIp(req),
  })

  return mapAlias(full.rows[0])
}

export async function deleteAlias(actorId: string, aliasId: string, req?: Request): Promise<boolean> {
  const { rows } = await getPool().query<{ domain_id: string }>(
    'SELECT domain_id FROM aliases WHERE id = $1',
    [aliasId],
  )
  if (!rows[0]) return false

  const actor = await getActorDomainScope(actorId)
  if (!canAccessDomain(actor, rows[0].domain_id)) throw new Error('Forbidden')

  const { rowCount } = await getPool().query('DELETE FROM aliases WHERE id = $1', [aliasId])

  await logAudit({
    userId: actorId,
    action: 'alias_delete',
    targetType: 'alias',
    targetId: aliasId,
    ipAddress: getIp(req),
  })

  return (rowCount ?? 0) > 0
}

/** Разрешает alias@domain → email владельца ящика */
export async function resolveAliasAddress(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  const { rows } = await getPool().query<{ destination_email: string }>(
    `SELECT u.email AS destination_email
     FROM aliases a
     JOIN users u ON u.id = a.destination_user_id
     WHERE LOWER(a.source_address) = $1 AND a.is_active = true AND u.is_active = true
     LIMIT 1`,
    [normalized],
  )
  return rows[0]?.destination_email ?? null
}

function getIp(req?: Request): string | null {
  if (!req) return null
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? null
  return req.ip ?? null
}
