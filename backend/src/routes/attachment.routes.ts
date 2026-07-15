import { Router } from 'express'
import { authGuard } from '../middleware/authGuard'
import { requireRequestUserId } from '../utils/requestUser'
import { uploadAttachment } from '../middleware/upload'
import { saveUploadedAttachment, getAttachmentForUser } from '../services/attachment.service'

const router = Router()

router.use(authGuard)

router.post('/upload', uploadAttachment.single('file'), async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return

    if (!req.file) {
      res.status(400).json({ error: 'File is required' })
      return
    }

    const attachment = await saveUploadedAttachment(userId, req.file)
    res.status(201).json(attachment)
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return

    const result = await getAttachmentForUser(userId, req.params.id)
    if (!result) {
      res.status(404).json({ error: 'Attachment not found' })
      return
    }

    const { meta, buffer } = result
    if (meta.content_type) {
      res.setHeader('Content-Type', meta.content_type)
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(meta.filename)}"`,
    )
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

export default router
