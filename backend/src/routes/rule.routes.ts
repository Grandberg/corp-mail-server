import { Router } from 'express'
import { z } from 'zod'
import { authGuard } from '../middleware/authGuard'
import { requireRequestUserId } from '../utils/requestUser'
import { createRule, deleteRule, listRules, updateRule } from '../services/rule.service'

const router = Router()
router.use(authGuard)

const conditionSchema = z.object({
  field: z.enum(['from', 'to', 'subject']),
  operator: z.enum(['contains', 'equals']),
  value: z.string().trim().min(1).max(500),
})

const actionSchema = z.object({
  type: z.enum(['move', 'mark_read', 'delete', 'star']),
  params: z.object({ folder: z.string().optional() }).optional(),
})

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(255),
  conditions: z.array(conditionSchema).min(1),
  actions: z.array(actionSchema).min(1),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
})

router.get('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const rules = await listRules(userId)
    res.json(rules)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const input = ruleSchema.parse(req.body)
    const rule = await createRule(userId, input)
    res.status(201).json(rule)
  } catch (err) {
    next(err)
  }
})

router.put('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const input = ruleSchema.parse(req.body)
    const rule = await updateRule(userId, req.params.id, input)
    if (!rule) {
      res.status(404).json({ error: 'Rule not found' })
      return
    }
    res.json(rule)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const ok = await deleteRule(userId, req.params.id)
    if (!ok) {
      res.status(404).json({ error: 'Rule not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
