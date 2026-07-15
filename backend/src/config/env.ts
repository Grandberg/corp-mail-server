import { z } from 'zod'
import { loadSecretsFromFiles } from './loadSecrets'

loadSecretsFromFiles()

const KNOWN_WEAK_JWT_SECRETS = new Set([
  'change-me-in-production-secret',
  'change-me-to-a-random-secret-string-in-production',
  'REPLACE_WITH_RANDOM_64_HEX_CHARS',
])

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(4000),

    DB_MODE: z.enum(['external', 'local']).default('external'),
    DATABASE_URL: z.string().optional(),
    DB_HOST: z.string().default('email_db'),
    DB_PORT: z.coerce.number().default(5432),
    DB_USER: z.string().default('mailuser'),
    DB_PASSWORD: z.string().default('mail_password'),
    DB_NAME: z.string().default('corp_mail'),

    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD: z.string().default('dev_redis_password'),

    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(1000).default(120),

    AUTH_ENABLED: z.preprocess(
      (val) => {
        if (typeof val === 'string') return val === 'true' || val === '1'
        return Boolean(val)
      },
      z.boolean().default(true),
    ),
    AUTH_ALLOW_REGISTER: z.preprocess(
      (val) => {
        if (typeof val === 'string') return val === 'true' || val === '1'
        return val === undefined ? false : Boolean(val)
      },
      z.boolean().default(false),
    ),
    JWT_SECRET: z
      .string()
      .min(16, 'JWT_SECRET must be at least 16 characters')
      .default('dev-jwt-secret-local-only'),
    JWT_EXPIRES_IN: z.string().default('8h'),
    JWT_REFRESH_GRACE: z.string().default('30d'),

    APP_TIMEZONE: z.string().default('Europe/Moscow'),
    MAIL_MAX_ATTACHMENT_SIZE: z.coerce.number().int().positive().default(26_214_400),
    MAIL_DATA_DIR: z.string().default('./mail_data'),
    /** Публичный IP сервера для DNS A/SPF записей */
    SERVER_PUBLIC_IP: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().trim().default('127.0.0.1'),
    ),
    /** Hostname MTA (по умолчанию mail.<domain>) */
    MAIL_HOSTNAME: z
      .string()
      .optional()
      .transform((v) => (v?.trim() ? v.trim() : undefined)),

    MTA_ENABLED: z.preprocess(
      (val) => {
        if (typeof val === 'string') return val === 'true' || val === '1'
        return Boolean(val)
      },
      z.boolean().default(false),
    ),
    HARAKA_HOST: z.string().default('email_haraka'),
    HARAKA_SUBMISSION_PORT: z.coerce.number().default(587),
    INTERNAL_API_SECRET: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.DB_MODE === 'external' && !data.DATABASE_URL && data.NODE_ENV === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DATABASE_URL is required when DB_MODE=external in production',
        path: ['DATABASE_URL'],
      })
    }

    if (data.NODE_ENV === 'production') {
      if (KNOWN_WEAK_JWT_SECRETS.has(data.JWT_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JWT_SECRET must be a unique random value in production',
          path: ['JWT_SECRET'],
        })
      }

      if (data.CORS_ORIGIN === '*') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CORS_ORIGIN must not be "*" in production',
          path: ['CORS_ORIGIN'],
        })
      }

      if (data.SERVER_PUBLIC_IP === '127.0.0.1' || data.SERVER_PUBLIC_IP === '0.0.0.0') {
        console.warn(
          '[Config] SERVER_PUBLIC_IP=127.0.0.1 — задайте реальный IP в /opt/email/secret/server_public_ip ' +
            'или переменной SERVER_PUBLIC_IP в стеке Portainer',
        )
      }
    }
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  })
  process.exit(1)
}

export const env = parsed.data

export function getCorsOrigins(): string[] | '*' {
  if (env.CORS_ORIGIN === '*') return '*'
  return env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}
