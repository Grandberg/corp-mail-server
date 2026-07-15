import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requireRole } from '../middleware/authGuard'
import { requireRequestUserId } from '../utils/requestUser'
import {
  getAdminStats,
  getAuditLog,
  applyDatabaseConfig,
  getDbConfigInfo,
  getServerMailConfig,
  testDatabaseConnection,
} from '../services/audit.service'
import { checkMtaConnection, isMtaConfigured } from '../services/mta.service'
import {
  getTelegramBotConfig,
  saveTelegramBotConfig,
  getTelegramBotStatus,
  validateTelegramBotToken,
} from '../services/telegram.service'


const router = Router()

router.use(authGuard, requireRole('admin', 'superadmin'))

router.get('/stats', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const stats = await getAdminStats(userId)
    res.json(stats)
  } catch (err) {
    next(err)
  }
})

router.get('/audit-log', async (req, res, next) => {
  try {
    const userId = requireRequestUserId(req, res)
    if (!userId) return
    const page = z.coerce.number().int().min(1).optional().parse(req.query.page) ?? 1
    const result = await getAuditLog(userId, page)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

router.get('/queue', async (_req, res) => {
  const mtaEnabled = isMtaConfigured()
  const mtaConnected = mtaEnabled ? await checkMtaConnection() : false
  res.json({
    items: [],
    mta_enabled: mtaEnabled,
    mta_connected: mtaConnected,
    message: mtaEnabled
      ? mtaConnected
        ? 'Haraka MTA подключён'
        : 'Haraka включён, но SMTP недоступен'
      : 'MTA отключён (MTA_ENABLED=false). Подключите docker-compose.mta.yml',
  })
})

router.get('/mail-config', async (_req, res, next) => {
  try {
    const config = await getServerMailConfig()
    res.json(config)
  } catch (err) {
    next(err)
  }
})

router.get('/db-config', async (_req, res, next) => {
  try {
    const info = await getDbConfigInfo()
    res.json(info)
  } catch (err) {
    next(err)
  }
})

router.post('/db-config/test', async (req, res, next) => {
  try {
    const { connectionString } = z.object({ connectionString: z.string().min(1) }).parse(req.body)
    const ok = await testDatabaseConnection(connectionString)
    res.json({ success: ok })
  } catch (err) {
    next(err)
  }
})

router.put('/db-config', async (req, res, next) => {
  try {
    const { connectionString } = z.object({ connectionString: z.string().min(1) }).parse(req.body)
    const result = await applyDatabaseConfig(connectionString)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

router.get('/telegram-config', async (_req, res, next) => {
  try {
    const config = await getTelegramBotConfig()
    res.json(config)
  } catch (err) {
    next(err)
  }
})

router.get('/telegram-status', async (_req, res, next) => {
  try {
    const status = getTelegramBotStatus()
    res.json(status)
  } catch (err) {
    next(err)
  }
})

router.put('/telegram-config', async (req, res, next) => {
  try {
    const { token, username } = z
      .object({
        token: z.string().trim().min(1),
        username: z.string().trim().min(1),
      })
      .parse(req.body)

    // Проверяем работоспособность токена и наличие интернет-соединения до сохранения в БД
    const validation = await validateTelegramBotToken(token)
    if (!validation.ok) {
      res.status(400).json({ error: validation.error })
      return
    }

    await saveTelegramBotConfig(token, username)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router

