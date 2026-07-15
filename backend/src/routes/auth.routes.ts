import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env'
import { authGuard } from '../middleware/authGuard'
import { loginLimiter } from '../middleware/rateLimiter'
import { requireRequestUserId } from '../utils/requestUser'
import { verifyJwtForRefresh } from '../utils/jwtRefresh'
import {
  createUser,
  findUserByEmail,
  findUserById,
  isFirstRun,
  issueToken,
  updateLastLogin,
  verifyPassword,
} from '../services/auth.service'
import { toPublicUser } from '../types/user'

const router = Router()

const emailSchema = z.string().trim().email('Invalid email address')
const passwordSchema = z.string().min(6, 'Password must be at least 6 characters')

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(255).optional(),
})

function buildAuthResponse(user: ReturnType<typeof toPublicUser>) {
  const { token, expiresIn } = issueToken(user.id, user.email)
  return { token, expiresIn, user }
}

router.get('/config', async (_req, res, next) => {
  try {
    const firstRun = await isFirstRun()
    res.json({
      authEnabled: env.AUTH_ENABLED,
      isFirstRun: firstRun,
      authAllowRegister: env.AUTH_ALLOW_REGISTER || firstRun,
    })
  } catch (err) {
    next(err)
  }
})

router.get('/me', authGuard, async (req, res, next) => {
  try {
    if (!env.AUTH_ENABLED) {
      res.json({ user: null })
      return
    }

    const userId = requireRequestUserId(req, res)
    if (!userId) return

    const user = await findUserById(userId)
    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    res.json({ user: toPublicUser(user) })
  } catch (err) {
    next(err)
  }
})

router.post('/refresh', async (req, res, next) => {
  try {
    if (!env.AUTH_ENABLED) {
      res.status(400).json({ error: 'Auth is disabled' })
      return
    }

    const payload = verifyJwtForRefresh(req)
    if (!payload) {
      res.status(401).json({ error: 'Cannot refresh session' })
      return
    }

    const user = await findUserById(payload.sub)
    if (!user || !user.is_active) {
      res.status(401).json({ error: 'Cannot refresh session' })
      return
    }

    res.json(buildAuthResponse(toPublicUser(user)))
  } catch (err) {
    next(err)
  }
})

router.post('/register', async (req, res, next) => {
  try {
    if (!env.AUTH_ENABLED) {
      res.status(403).json({ error: 'Registration is disabled when AUTH_ENABLED=false' })
      return
    }

    const firstRun = await isFirstRun()
    if (!firstRun && !env.AUTH_ALLOW_REGISTER) {
      res.status(403).json({ error: 'Registration is disabled on this server' })
      return
    }

    const { email, password, displayName } = registerSchema.parse(req.body)
    const existing = await findUserByEmail(email)
    if (existing) {
      res.status(409).json({ error: 'Email already registered' })
      return
    }

    const user = await createUser({ email, password, displayName })
    res.status(201).json(buildAuthResponse(user))
  } catch (err) {
    next(err)
  }
})

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    if (!env.AUTH_ENABLED) {
      res.json({ token: 'auth-disabled', user: null })
      return
    }

    const { email, password } = loginSchema.parse(req.body)
    const user = await findUserByEmail(email)
    const isValid = user ? await verifyPassword(user, password) : false

    if (!isValid || !user?.is_active) {
      await new Promise((r) => setTimeout(r, 300))
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    await updateLastLogin(user.id)
    res.json(buildAuthResponse(toPublicUser(user)))
  } catch (err) {
    next(err)
  }
})

export default router
