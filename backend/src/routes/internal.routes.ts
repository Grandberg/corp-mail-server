import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env'
import { processInboundRawEmail } from '../services/inbound.service'

const router = Router()

function checkInternalSecret(header: string | undefined): boolean {
  const secret = env.INTERNAL_API_SECRET?.trim()
  if (!secret) return false
  return header === secret
}

router.post('/inbound', async (req, res, next) => {
  try {
    if (!checkInternalSecret(req.header('x-internal-secret'))) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const { recipient, raw } = z
      .object({
        recipient: z.string().email(),
        raw: z.string().min(1),
      })
      .parse(req.body)

    const result = await processInboundRawEmail(recipient, raw)
    if (!result.delivered) {
      console.warn(`[Inbound] rejected ${recipient}: ${result.reason ?? 'unknown'}`)
      res.status(422).json(result)
      return
    }
    console.info(`[Inbound] delivered to ${recipient}`)
    res.status(201).json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
