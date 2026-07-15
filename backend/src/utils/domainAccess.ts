import type { Request } from 'express'
import type { UserRole } from '../config/constants'
import { findUserById } from '../services/auth.service'

export async function getActorDomainScope(
  userId: string,
): Promise<{ role: UserRole; domainId: string | null; isSuperadmin: boolean }> {
  const user = await findUserById(userId)
  if (!user) throw new Error('User not found')
  return {
    role: user.role,
    domainId: user.domain_id,
    isSuperadmin: user.role === 'superadmin',
  }
}

export function canAccessDomain(
  actor: { role: UserRole; domainId: string | null; isSuperadmin: boolean },
  targetDomainId: string,
): boolean {
  if (actor.isSuperadmin) return true
  if (actor.role === 'admin' && actor.domainId === targetDomainId) return true
  return false
}

export function getClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? null
  return req.ip ?? null
}
