import { Router } from 'express'
import { checkDbConnection } from '../services/db.service'
import { checkRedisConnection } from '../services/cache.service'
import { checkMtaConnection, isMtaConfigured } from '../services/mta.service'
import { env } from '../config/env'

const router = Router()

router.get('/', async (_req, res) => {
  const dbOk = await checkDbConnection()
  const redisOk = await checkRedisConnection()
  const mtaOk = isMtaConfigured() ? await checkMtaConnection() : null

  res.status(200).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'connected' : 'disconnected',
    redis: redisOk ? 'connected' : env.REDIS_PASSWORD ? 'disconnected' : 'not_configured',
    mta: mtaOk === null ? 'disabled' : mtaOk ? 'connected' : 'disconnected',
    mtaEnabled: env.MTA_ENABLED,
    authEnabled: env.AUTH_ENABLED,
    authAllowRegister: env.AUTH_ALLOW_REGISTER,
    uptime: Math.floor(process.uptime()),
  })
})

export default router
