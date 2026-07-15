import type { Request, Response } from 'express'
import { env } from '../config/env'

export function getRequestUserId(req: Request): string | null {
  if (!env.AUTH_ENABLED) return null
  return req.userId ?? null
}

export function requireRequestUserId(req: Request, res: Response): string | null {
  if (!env.AUTH_ENABLED) return null
  const userId = req.userId
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return userId
}
