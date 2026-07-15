import type { Request } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'

export interface JwtRefreshPayload {
  sub: string
  email?: string
  exp?: number
}

function durationToMs(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d|w|y)$/i.exec(value.trim())
  if (!match) return 30 * 24 * 60 * 60 * 1000
  const n = Number(match[1])
  const unit = match[2].toLowerCase()
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    y: 31_536_000_000,
  }
  return n * (multipliers[unit] ?? 86_400_000)
}

export function verifyJwtForRefresh(req: Request): JwtRefreshPayload | null {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7).trim()
  if (!token || token === 'auth-disabled') return null

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { ignoreExpiration: true }) as JwtRefreshPayload
    if (!payload.sub) return null

    if (payload.exp) {
      const expiredAtMs = payload.exp * 1000
      const graceMs = durationToMs(env.JWT_REFRESH_GRACE)
      if (Date.now() > expiredAtMs + graceMs) {
        return null
      }
    }

    return payload
  } catch {
    return null
  }
}
