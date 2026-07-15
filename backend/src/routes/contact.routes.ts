import { Router } from 'express'
import { z } from 'zod'
import { authGuard } from '../middleware/authGuard'
import { requireRequestUserId } from '../utils/requestUser'
import {
  createContact,
  createContactGroup,
  deleteContact,
  deleteContactGroup,
  listContactGroups,
  listContacts,
  searchRecipients,
  updateContact,
} from '../services/contact.service'

const router = Router()
router.use(authGuard)

const contactSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(255).optional(),
  position: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(5000).optional(),
  isShared: z.boolean().optional(),
})

router.get('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const contacts = await listContacts(userId)
    res.json(contacts)
  } catch (err) {
    next(err)
  }
})

router.get('/search', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const q = z.string().parse(req.query.q ?? '')
    const results = await searchRecipients(userId, q)
    res.json(results)
  } catch (err) {
    next(err)
  }
})

router.get('/groups', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const groups = await listContactGroups(userId)
    res.json(groups)
  } catch (err) {
    next(err)
  }
})

router.post('/groups', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const { name, isShared } = z
      .object({ name: z.string().trim().min(1).max(255), isShared: z.boolean().optional() })
      .parse(req.body)
    const group = await createContactGroup(userId, name, isShared)
    res.status(201).json(group)
  } catch (err) {
    next(err)
  }
})

router.delete('/groups/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const ok = await deleteContactGroup(userId, req.params.id)
    if (!ok) {
      res.status(404).json({ error: 'Group not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const input = contactSchema.parse(req.body)
    const contact = await createContact(userId, input)
    res.status(201).json(contact)
  } catch (err) {
    next(err)
  }
})

router.put('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const input = contactSchema.partial().parse(req.body)
    const contact = await updateContact(userId, req.params.id, input)
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    res.json(contact)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const ok = await deleteContact(userId, req.params.id)
    if (!ok) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
