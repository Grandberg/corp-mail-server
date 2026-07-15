import { Router } from 'express'
import { z } from 'zod'
import { getAvatarFile } from '../services/settings.service'

const router = Router()

router.get('/:userId', async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.userId)
    const avatar = await getAvatarFile(userId)
    if (!avatar) {
      res.status(404).json({ error: 'Avatar not found' })
      return
    }
    res.setHeader('Content-Type', avatar.contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(avatar.buffer)
  } catch (err) {
    next(err)
  }
})

export default router
