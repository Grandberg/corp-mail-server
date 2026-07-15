import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requireRole } from '../middleware/authGuard'
import { ROLES } from '../config/constants'
import { requireRequestUserId } from '../utils/requestUser'
import {
  createDomainUser,
  deleteDomainUser,
  listUsers,
  updateDomainUser,
} from '../services/user.service'

const router = Router()

router.use(authGuard, requireRole('admin', 'superadmin'))

router.get('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const domainId = z.string().uuid().optional().parse(req.query.domainId)
    const users = await listUsers(userId, domainId)
    res.json(users)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        displayName: z.string().optional(),
        role: z.enum(ROLES).optional(),
        domainId: z.string().uuid(),
      })
      .parse(req.body)
    const user = await createDomainUser(userId, body, req)
    res.status(201).json(user)
  } catch (err) {
    next(err)
  }
})

router.put('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const body = z
      .object({
        displayName: z.string().nullable().optional(),
        role: z.enum(ROLES).optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(6).optional(),
      })
      .parse(req.body)
    const user = await updateDomainUser(userId, req.params.id, body, req)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(user)
  } catch (err) {
    next(err)
  }
})

router.put('/:id/role', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const { role } = z.object({ role: z.enum(ROLES) }).parse(req.body)
    const user = await updateDomainUser(userId, req.params.id, { role }, req)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(user)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const ok = await deleteDomainUser(userId, req.params.id, req)
    if (!ok) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
