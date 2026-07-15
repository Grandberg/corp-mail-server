import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import type { UserRole } from '../config/constants'
import { findUserById } from '../services/auth.service'

interface JwtPayload {
  sub: string
  email?: string
}

export function authGuard(req: Request, res: Response, next: NextFunction): void {
  if (!env.AUTH_ENABLED) {
    next()
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header missing or malformed' })
    return
  }

  const token = authHeader.slice(7).trim()
  if (!token || token === 'auth-disabled') {
    res.status(401).json({ error: 'Authorization header missing or malformed' })
    return
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload
    if (!payload.sub) {
      res.status(401).json({ error: 'Invalid or expired token' })
      return
    }
    req.userId = payload.sub
    req.email = payload.email
    next()
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' })
      return
    }
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function requireRole(...roles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!env.AUTH_ENABLED) {
      next()
      return
    }

    const userId = req.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const user = await findUserById(userId)
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    req.role = user.role
    next()
  }
}
