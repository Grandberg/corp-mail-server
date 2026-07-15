import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env, getCorsOrigins } from './config/env'
import { rateLimiter } from './middleware/rateLimiter'
import { errorHandler } from './middleware/errorHandler'
import { authGuard } from './middleware/authGuard'
import healthRouter from './routes/health.routes'
import authRouter from './routes/auth.routes'
import emailRouter from './routes/email.routes'
import folderRouter from './routes/folder.routes'
import attachmentRouter from './routes/attachment.routes'
import adminDomainsRouter from './routes/admin.domains.routes'
import adminUsersRouter from './routes/admin.users.routes'
import adminAliasesRouter from './routes/admin.aliases.routes'
import adminSystemRouter from './routes/admin.system.routes'
import contactRouter from './routes/contact.routes'
import ruleRouter from './routes/rule.routes'
import settingsRouter from './routes/settings.routes'
import avatarRouter from './routes/avatar.routes'
import internalRouter from './routes/internal.routes'
import { runMigrations } from './services/db.service'
import { startCronJobs } from './services/cron.service'
import { startTelegramBot } from './services/telegram.service'
import { initScheduler } from './services/scheduler.service'


const app = express()

app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : 'loopback')

app.use(
  helmet({
    // Ответы — JSON API, а не HTML-документы; CSP/COEP для страниц задаются в nginx фронта.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
)

const corsOrigins = getCorsOrigins()
app.use(
  cors({
    origin: corsOrigins === '*' ? true : corsOrigins,
  }),
)
app.use(express.json({ limit: '2mb' }))
app.use(rateLimiter)

app.use('/health', healthRouter)
app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)

app.use('/api/emails', emailRouter)
app.use('/api/folders', folderRouter)
app.use('/api/attachments', attachmentRouter)

app.use('/api/admin/domains', adminDomainsRouter)
app.use('/api/admin/users', adminUsersRouter)
app.use('/api/admin/aliases', adminAliasesRouter)
app.use('/api/admin/system', adminSystemRouter)

app.use('/api/contacts', contactRouter)
app.use('/api/rules', ruleRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/avatars', avatarRouter)
app.use('/api/internal', internalRouter)

app.get('/api/me', authGuard, (_req, res) => {
  res.redirect(307, '/api/auth/me')
})

app.use(errorHandler)

async function start(): Promise<void> {
  try {
    await runMigrations()
    await startTelegramBot()
    await initScheduler()
  } catch (err) {
    console.error('[Startup] DB migrations, Telegram bot start, or Scheduler init failed:', err)
    process.exit(1)
  }


  app.listen(env.PORT, () => {
    console.log(`[Server] Running on port ${env.PORT} (${env.NODE_ENV})`)
    console.log(`[Server] DB mode: ${env.DB_MODE}`)
    console.log(`[Server] DNS server IP: ${env.SERVER_PUBLIC_IP}`)
    startCronJobs()
  })
}

start()
