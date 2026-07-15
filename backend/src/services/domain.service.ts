import type { Request } from 'express'
import { getPool } from './db.service'
import type { Domain, DomainVerificationResult, DnsRecord } from '../types/domain'
import { canAccessDomain, getActorDomainScope } from '../utils/domainAccess'
import { generateAndStoreDkimKeys } from './dkim.service'
import { generateRequiredRecords, verifyDnsRecords, applyVerificationStatuses, getServerMailHostname, resolvePtr } from './dns.service'
import { env } from '../config/env'
import { logAudit } from './audit.service'

interface DomainRow {
  id: string
  domain_name: string
  is_active: boolean
  is_verified: boolean
  mx_verified: boolean
  spf_verified: boolean
  dkim_verified: boolean
  dmarc_verified: boolean
  a_verified: boolean
  dns_checked_at: Date | null
  dkim_selector: string
  dkim_public_key: string | null
  max_users: number
  max_mailbox_size_mb: number
  created_at: Date
  updated_at: Date
}

function mapDomain(row: DomainRow): Domain {
  return {
    id: row.id,
    domain_name: row.domain_name,
    is_active: row.is_active,
    is_verified: row.is_verified,
    mx_verified: row.mx_verified,
    spf_verified: row.spf_verified,
    dkim_verified: row.dkim_verified,
    dmarc_verified: row.dmarc_verified,
    a_verified: row.a_verified,
    dns_checked_at: row.dns_checked_at?.toISOString() ?? null,
    dkim_selector: row.dkim_selector,
    dkim_public_key: row.dkim_public_key,
    max_users: row.max_users,
    max_mailbox_size_mb: row.max_mailbox_size_mb,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }
}

async function getDomainRow(id: string): Promise<DomainRow | null> {
  const { rows } = await getPool().query<DomainRow>(
    `SELECT id, domain_name, is_active, is_verified,
            mx_verified, spf_verified, dkim_verified, dmarc_verified, a_verified, dns_checked_at,
            dkim_selector, dkim_public_key, max_users, max_mailbox_size_mb,
            created_at, updated_at
     FROM domains WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function listDomains(userId: string): Promise<Domain[]> {
  const actor = await getActorDomainScope(userId)
  if (actor.isSuperadmin) {
    const { rows } = await getPool().query<DomainRow>(
      `SELECT id, domain_name, is_active, is_verified,
              mx_verified, spf_verified, dkim_verified, dmarc_verified, a_verified, dns_checked_at,
              dkim_selector, dkim_public_key, max_users, max_mailbox_size_mb,
              created_at, updated_at
       FROM domains ORDER BY domain_name`,
    )
    return rows.map(mapDomain)
  }

  if (!actor.domainId) return []
  const { rows } = await getPool().query<DomainRow>(
    `SELECT id, domain_name, is_active, is_verified,
            mx_verified, spf_verified, dkim_verified, dmarc_verified, a_verified, dns_checked_at,
            dkim_selector, dkim_public_key, max_users, max_mailbox_size_mb,
            created_at, updated_at
     FROM domains WHERE id = $1`,
    [actor.domainId],
  )
  return rows.map(mapDomain)
}

export async function createDomain(
  userId: string,
  domainName: string,
  req?: Request,
): Promise<Domain> {
  const actor = await getActorDomainScope(userId)
  if (!actor.isSuperadmin) {
    throw new Error('Only superadmin can add domains')
  }

  const normalized = domainName.trim().toLowerCase()
  const { rows } = await getPool().query<DomainRow>(
    `INSERT INTO domains (domain_name, is_active, is_verified)
     VALUES ($1, false, false)
     RETURNING id, domain_name, is_active, is_verified,
               mx_verified, spf_verified, dkim_verified, dmarc_verified,
               dkim_selector, dkim_public_key, max_users, max_mailbox_size_mb,
               created_at, updated_at`,
    [normalized],
  )

  await generateAndStoreDkimKeys(rows[0].id, 'mail')
  const refreshed = await getDomainRow(rows[0].id)
  const domain = mapDomain(refreshed ?? rows[0])

  await logAudit({
    userId,
    action: 'domain_add',
    targetType: 'domain',
    targetId: domain.id,
    details: { domain_name: domain.domain_name },
    ipAddress: req ? getIp(req) : null,
  })

  return domain
}

export async function getDomainById(userId: string, domainId: string): Promise<Domain | null> {
  const actor = await getActorDomainScope(userId)
  if (!canAccessDomain(actor, domainId)) return null
  const row = await getDomainRow(domainId)
  return row ? mapDomain(row) : null
}

export async function getDnsRecordsForDomain(userId: string, domainId: string): Promise<DnsRecord[]> {
  const domain = await getDomainById(userId, domainId)
  if (!domain) throw new Error('Domain not found')

  const base = generateRequiredRecords(
    domain.domain_name,
    env.SERVER_PUBLIC_IP,
    domain.dkim_selector,
    domain.dkim_public_key,
  )

  const legacyVerified = domain.is_verified && !domain.dns_checked_at
  const dnsChecked = Boolean(domain.dns_checked_at) || legacyVerified
  const ptrHost = getServerMailHostname()
  const ptrActual = await resolvePtr(env.SERVER_PUBLIC_IP)
  const ptrExpected = ptrHost.toLowerCase().replace(/\.$/, '')
  const ptrOk = ptrActual.some((h) => h === ptrExpected)
  const flags = legacyVerified
    ? { a: true, mx: true, spf: true, dkim: true, dmarc: true, ptr: ptrOk }
    : {
        a: domain.a_verified,
        mx: domain.mx_verified,
        spf: domain.spf_verified,
        dkim: domain.dkim_verified,
        dmarc: domain.dmarc_verified,
        ptr: ptrOk,
      }

  return applyVerificationStatuses(base, flags, dnsChecked, ptrActual)
}

export async function verifyDomain(
  userId: string,
  domainId: string,
  req?: Request,
): Promise<DomainVerificationResult> {
  const domain = await getDomainById(userId, domainId)
  if (!domain) throw new Error('Domain not found')

  const result = await verifyDnsRecords(
    domain.domain_name,
    domain.dkim_selector,
    domain.dkim_public_key,
  )

  const allVerified = result.mx && result.spf && result.dkim && result.dmarc && result.a

  await getPool().query(
    `UPDATE domains SET
       mx_verified = $2, spf_verified = $3, dkim_verified = $4, dmarc_verified = $5,
       a_verified = $6, is_verified = $7, is_active = $7,
       dns_checked_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [domainId, result.mx, result.spf, result.dkim, result.dmarc, result.a, allVerified],
  )

  const updated = await getDomainRow(domainId)
  if (!updated) throw new Error('Domain not found')

  await logAudit({
    userId,
    action: 'domain_verify',
    targetType: 'domain',
    targetId: domainId,
    details: { all_verified: allVerified, ...result },
    ipAddress: req ? getIp(req) : null,
  })

  return {
    domain: mapDomain(updated),
    records: result.records,
    all_verified: allVerified,
  }
}

export async function generateDomainDkim(
  userId: string,
  domainId: string,
): Promise<{ selector: string; publicKey: string; dnsValue: string }> {
  const domain = await getDomainById(userId, domainId)
  if (!domain) throw new Error('Domain not found')
  return generateAndStoreDkimKeys(domainId, domain.dkim_selector || 'mail')
}

export async function deleteDomain(userId: string, domainId: string, req?: Request): Promise<boolean> {
  const actor = await getActorDomainScope(userId)
  if (!actor.isSuperadmin) throw new Error('Only superadmin can delete domains')

  const { rowCount } = await getPool().query('DELETE FROM domains WHERE id = $1', [domainId])
  if ((rowCount ?? 0) > 0) {
    await logAudit({
      userId,
      action: 'domain_delete',
      targetType: 'domain',
      targetId: domainId,
      ipAddress: req ? getIp(req) : null,
    })
  }
  return (rowCount ?? 0) > 0
}

function getIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? null
  return req.ip ?? null
}
