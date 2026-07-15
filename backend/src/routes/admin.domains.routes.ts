import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requireRole } from '../middleware/authGuard'
import { requireRequestUserId } from '../utils/requestUser'
import {
  createDomain,
  deleteDomain,
  generateDomainDkim,
  getDnsRecordsForDomain,
  getDomainById,
  listDomains,
  verifyDomain,
} from '../services/domain.service'

const router = Router()

router.use(authGuard, requireRole('admin', 'superadmin'))

router.get('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const domains = await listDomains(userId)
    res.json(domains)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const { domainName } = z.object({ domainName: z.string().trim().min(3) }).parse(req.body)
    const domain = await createDomain(userId, domainName, req)
    res.status(201).json(domain)
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const domain = await getDomainById(userId, req.params.id)
    if (!domain) {
      res.status(404).json({ error: 'Domain not found' })
      return
    }
    res.json(domain)
  } catch (err) {
    next(err)
  }
})

router.get('/:id/dns-records', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const records = await getDnsRecordsForDomain(userId, req.params.id)
    res.json(records)
  } catch (err) {
    next(err)
  }
})

router.post('/:id/verify', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const result = await verifyDomain(userId, req.params.id, req)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

router.post('/:id/generate-dkim', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const keys = await generateDomainDkim(userId, req.params.id)
    res.json(keys)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const ok = await deleteDomain(userId, req.params.id, req)
    if (!ok) {
      res.status(404).json({ error: 'Domain not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
