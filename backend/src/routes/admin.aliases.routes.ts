import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requireRole } from '../middleware/authGuard'
import { requireRequestUserId } from '../utils/requestUser'
import { createAlias, deleteAlias, listAliases } from '../services/alias.service'

const router = Router()

router.use(authGuard, requireRole('admin', 'superadmin'))

router.get('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const domainId = z.string().uuid().optional().parse(req.query.domainId)
    const aliases = await listAliases(userId, domainId)
    res.json(aliases)
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
        sourceAddress: z.string().email(),
        destinationUserId: z.string().uuid(),
        domainId: z.string().uuid(),
      })
      .parse(req.body)
    const alias = await createAlias(userId, body, req)
    res.status(201).json(alias)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const ok = await deleteAlias(userId, req.params.id, req)
    if (!ok) {
      res.status(404).json({ error: 'Alias not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
