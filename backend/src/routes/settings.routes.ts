import { Router } from 'express'
import { z } from 'zod'
import { authGuard } from '../middleware/authGuard'
import { requireRequestUserId } from '../utils/requestUser'
import { uploadAvatar } from '../middleware/upload'
import {
  changePassword,
  getUserSettings,
  updateAutoReply,
  updateAvatar,
  updateProfile,
  updateSignature,
  updateTelegramSettings,
  updateGroupByContacts,
} from '../services/settings.service'
import { sendTestNotification } from '../services/telegram.service'


const router = Router()
router.use(authGuard)

router.put('/avatar', uploadAvatar.single('file'), async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    if (!req.file) {
      res.status(400).json({ error: 'Файл изображения обязателен' })
      return
    }
    const settings = await updateAvatar(userId, req.file)
    if (!settings) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(settings)
  } catch (err) {
    next(err)
  }
})

router.get('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const settings = await getUserSettings(userId)
    if (!settings) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(settings)
  } catch (err) {
    next(err)
  }
})

router.put('/profile', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const { displayName } = z.object({ displayName: z.string().trim().max(255) }).parse(req.body)
    const settings = await updateProfile(userId, displayName)
    if (!settings) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(settings)
  } catch (err) {
    next(err)
  }
})

router.put('/signature', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const { signatureHtml } = z.object({ signatureHtml: z.string().max(50_000) }).parse(req.body)
    const settings = await updateSignature(userId, signatureHtml)
    if (!settings) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(settings)
  } catch (err) {
    next(err)
  }
})

router.put('/auto-reply', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const input = z
      .object({
        enabled: z.boolean(),
        subject: z.string().trim().max(255).optional(),
        body: z.string().trim().max(50_000).optional(),
      })
      .parse(req.body)
    const settings = await updateAutoReply(userId, input)
    if (!settings) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(settings)
  } catch (err) {
    next(err)
  }
})

router.put('/password', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const { currentPassword, newPassword } = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8).max(128),
      })
      .parse(req.body)
    await changePassword(userId, currentPassword, newPassword)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

router.put('/telegram', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const { username, phone, enabled } = z
      .object({
        username: z.string().trim().max(100).nullable(),
        phone: z.string().trim().max(50).nullable(),
        enabled: z.boolean(),
      })
      .parse(req.body)
    const settings = await updateTelegramSettings(userId, { username, phone, enabled })
    if (!settings) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(settings)
  } catch (err) {
    next(err)
  }
})

router.post('/telegram/test', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const success = await sendTestNotification(userId)
    res.json({ success })
  } catch (err) {
    next(err)
  }
})

router.put('/group-by-contacts', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const { groupByContacts } = z.object({ groupByContacts: z.boolean() }).parse(req.body)
    const settings = await updateGroupByContacts(userId, groupByContacts)
    if (!settings) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    res.json(settings)
  } catch (err) {
    next(err)
  }
})

export default router

