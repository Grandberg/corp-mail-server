import rateLimit from 'express-rate-limit'
import { env } from '../config/env'

export const rateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
})

/**
 * Защита от брутфорса логина: не более 4 неудачных попыток с одного IP за 3 часа.
 * Успешные входы не расходуют лимит (skipSuccessfulRequests), поэтому обычный
 * пользователь никогда не столкнётся с этим лимитом при нормальной работе.
 */
export const loginLimiter = rateLimit({
  windowMs: 3 * 60 * 60 * 1000,
  max: 4,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Слишком много неудачных попыток входа. Повторите через 3 часа.' },
})
