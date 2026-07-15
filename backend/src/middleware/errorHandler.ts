import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { AppHttpError } from '../utils/appHttpError'

const CLIENT_ERROR_STATUS: Record<string, number> = {
  Forbidden: 403,
  'Cannot assign superadmin role': 403,
  'Cannot delete yourself': 400,
  'Email must belong to the selected domain': 400,
  'Only superadmin can add domains': 403,
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
    return
  }

  if (err instanceof AppHttpError) {
    res.status(err.statusCode).json({ error: err.message })
    return
  }

  const pgCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : undefined
  if (pgCode === '23505') {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  const message = err instanceof Error ? err.message : 'Internal server error'
  const status = err instanceof Error ? (CLIENT_ERROR_STATUS[message] ?? 500) : 500
  if (status >= 500) {
    console.error('[ErrorHandler]', err)
  }
  res.status(status).json({ error: message })
}
