import { Router } from 'express'
import { z } from 'zod'
import { authGuard } from '../middleware/authGuard'
import { requireRequestUserId } from '../utils/requestUser'
import {
  bulkEmailAction,
  deleteEmail,
  forwardEmail,
  getEmailById,
  getEmailThread,
  listEmails,
  markEmailRead,
  replyToEmail,
  saveDraft,
  scheduleEmail,
  sendEmail,
  unscheduleEmail,
  updateEmail,
} from '../services/email.service'
import { subscribeMailEvents } from '../services/mailEvents.service'

const router = Router()

const addressSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().optional().nullable(),
})

const sendSchema = z.object({
  to: z.array(addressSchema).min(1),
  cc: z.array(addressSchema).optional(),
  bcc: z.array(addressSchema).optional(),
  subject: z.string().trim().min(1),
  bodyHtml: z.string(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  draftId: z.string().uuid().optional(),
  isPlainText: z.boolean().optional(),
})

const scheduleSchema = z.object({
  to: z.array(addressSchema).min(1),
  cc: z.array(addressSchema).optional(),
  bcc: z.array(addressSchema).optional(),
  subject: z.string().trim().min(1),
  bodyHtml: z.string(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  draftId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime({ offset: true }),
  isPlainText: z.boolean().optional(),
})

const draftSchema = z.object({
  to: z.array(addressSchema).optional(),
  cc: z.array(addressSchema).optional(),
  bcc: z.array(addressSchema).optional(),
  subject: z.string().optional(),
  bodyHtml: z.string().optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  draftId: z.string().uuid().optional(),
  isPlainText: z.boolean().optional(),
})

router.use(authGuard)

/** SSE: push-уведомления UI о новых письмах (без polling). */
router.get('/events', (req, res) => {
  const userId = requireRequestUserId(req, res)
  if (!userId) return
  subscribeMailEvents(userId, res)
})

router.get('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return

    const folder = z.string().parse(req.query.folder ?? 'inbox')
    const page = z.coerce.number().int().min(1).optional().parse(req.query.page)
    const search = z.string().optional().parse(req.query.search)
    const sort = z.string().optional().parse(req.query.sort)

    const result = await listEmails(userId, { folder, page, search, sort })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

router.get('/:id/thread', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return

    const messages = await getEmailThread(userId, req.params.id)
    if (messages.length === 0) {
      res.status(404).json({ error: 'Email not found' })
      return
    }

    const focus = messages.find((m) => m.id === req.params.id)
    if (focus && !focus.is_read) {
      await markEmailRead(userId, focus.id)
      focus.is_read = true
    }

    res.json({ messages })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return

    const email = await getEmailById(userId, req.params.id)
    if (!email) {
      res.status(404).json({ error: 'Email not found' })
      return
    }

    if (!email.is_read) {
      await markEmailRead(userId, email.id)
      email.is_read = true
    }

    res.json(email)
  } catch (err) {
    next(err)
  }
})

router.post('/send', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const input = sendSchema.parse(req.body)
    const email = await sendEmail(userId, input)
    res.status(201).json(email)
  } catch (err) {
    next(err)
  }
})

router.post('/schedule', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const input = scheduleSchema.parse(req.body)
    const email = await scheduleEmail(userId, input)
    res.status(201).json(email)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id/unschedule', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const email = await unscheduleEmail(userId, req.params.id)
    if (!email) {
      res.status(404).json({ error: 'Scheduled email not found' })
      return
    }
    res.json(email)
  } catch (err) {
    next(err)
  }
})

router.post('/draft', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const input = draftSchema.parse(req.body)
    const email = await saveDraft(userId, input)
    res.status(201).json(email)
  } catch (err) {
    next(err)
  }
})

router.put('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return

    const input = z
      .object({
        is_read: z.boolean().optional(),
        is_starred: z.boolean().optional(),
        folder: z.string().optional(),
      })
      .parse(req.body)

    const email = await updateEmail(userId, req.params.id, input)
    if (!email) {
      res.status(404).json({ error: 'Email not found' })
      return
    }
    res.json(email)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return

    const permanent = req.query.permanent === 'true'
    const ok = await deleteEmail(userId, req.params.id, permanent)
    if (!ok) {
      res.status(404).json({ error: 'Email not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

router.post('/:id/reply', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return

    const { bodyHtml, attachmentIds, isPlainText } = z
      .object({
        bodyHtml: z.string().min(1),
        attachmentIds: z.array(z.string().uuid()).optional(),
        isPlainText: z.boolean().optional(),
      })
      .parse(req.body)

    const email = await replyToEmail(userId, req.params.id, bodyHtml, attachmentIds, isPlainText)
    res.status(201).json(email)
  } catch (err) {
    next(err)
  }
})

router.post('/:id/forward', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return

    const { to, bodyHtml, isPlainText } = z
      .object({
        to: z.array(addressSchema).min(1),
        bodyHtml: z.string(),
        isPlainText: z.boolean().optional(),
      })
      .parse(req.body)

    const email = await forwardEmail(userId, req.params.id, to, bodyHtml, isPlainText)
    res.status(201).json(email)
  } catch (err) {
    next(err)
  }
})

router.patch('/bulk', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return

    const input = z
      .object({
        ids: z.array(z.string().uuid()).min(1),
        action: z.enum(['read', 'unread', 'star', 'unstar', 'trash', 'delete', 'move']),
        folder: z.string().optional(),
      })
      .parse(req.body)

    const count = await bulkEmailAction(userId, input)
    res.json({ updated: count })
  } catch (err) {
    next(err)
  }
})

export default router
