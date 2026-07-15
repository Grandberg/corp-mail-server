import { Router } from 'express'
import { z } from 'zod'
import { authGuard } from '../middleware/authGuard'
import { requireRequestUserId } from '../utils/requestUser'
import {
  createFolder,
  deleteFolder,
  listFolders,
  updateFolder,
} from '../services/folder.service'

const router = Router()

router.use(authGuard)

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
})

router.get('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const folders = await listFolders(userId)
    res.json(folders)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const { name, color } = createSchema.parse(req.body)
    const folder = await createFolder(userId, name, color)
    res.status(201).json(folder)
  } catch (err) {
    next(err)
  }
})

router.put('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const { name } = z.object({ name: z.string().trim().min(1).max(255) }).parse(req.body)
    const folder = await updateFolder(userId, req.params.id, name)
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' })
      return
    }
    res.json(folder)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const ok = await deleteFolder(userId, req.params.id)
    if (!ok) {
      res.status(404).json({ error: 'Folder not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
