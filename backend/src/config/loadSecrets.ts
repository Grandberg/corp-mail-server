import fs from 'fs'
import path from 'path'

const REQUIRED_IN_PRODUCTION = new Set(['DATABASE_URL', 'JWT_SECRET', 'REDIS_PASSWORD'])

const SECRET_MAPPINGS: ReadonlyArray<{
  envKey: string
  fileEnvKey: string
  fileName: string
}> = [
  { envKey: 'DATABASE_URL', fileEnvKey: 'DATABASE_URL_FILE', fileName: 'database_url' },
  { envKey: 'JWT_SECRET', fileEnvKey: 'JWT_SECRET_FILE', fileName: 'jwt_secret' },
  { envKey: 'DB_PASSWORD', fileEnvKey: 'DB_PASSWORD_FILE', fileName: 'db_password' },
  { envKey: 'REDIS_PASSWORD', fileEnvKey: 'REDIS_PASSWORD_FILE', fileName: 'redis_password' },
  { envKey: 'SERVER_PUBLIC_IP', fileEnvKey: 'SERVER_PUBLIC_IP_FILE', fileName: 'server_public_ip' },
  { envKey: 'MAIL_HOSTNAME', fileEnvKey: 'MAIL_HOSTNAME_FILE', fileName: 'mail_hostname' },
  { envKey: 'INTERNAL_API_SECRET', fileEnvKey: 'INTERNAL_API_SECRET_FILE', fileName: 'internal_api_secret' },
]

function readSecretFile(filePath: string, required: boolean): string | null {
  try {
    const value = fs.readFileSync(filePath, 'utf8').trim()
    if (value.length === 0) {
      console.warn(`[Secrets] Файл секрета пустой: ${filePath}`)
      return null
    }
    return value
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : undefined
    if (code === 'EACCES' || code === 'EPERM') {
      console.warn(
        `[Secrets] Нет доступа к ${filePath} (${code}). ` +
          'Entrypoint должен копировать секрет в /tmp/app-secrets.',
      )
    }
    if (!required) return null
    console.error(`[Secrets] Failed to read ${filePath}:`, err)
    process.exit(1)
  }
}

const OPTIONAL_CONFIG_KEYS = new Set(['SERVER_PUBLIC_IP', 'MAIL_HOSTNAME'])

const OPTIONAL_CONFIG_EXTRA_DIRS = ['/opt/email'] as const

function resolveSecretsDir(): string | null {
  const configured = process.env.EMAIL_SECRETS_DIR?.trim()
  if (configured) return configured

  const candidates = [
    '/opt/email/secret',
    path.resolve(process.cwd(), 'secrets'),
    path.resolve(process.cwd(), '..', 'secrets'),
    '/tmp/app-secrets',
  ]
  return candidates.find((dir) => fs.existsSync(dir)) ?? null
}

function resolveSecretFilePath(
  envKey: string,
  fileEnvKey: string,
  fileName: string,
  secretsDir: string | null,
): string | null {
  const explicit = process.env[fileEnvKey]?.trim()
  if (explicit && fs.existsSync(explicit)) {
    return explicit
  }

  const dirs: string[] = []
  if (secretsDir) dirs.push(secretsDir)
  if (OPTIONAL_CONFIG_KEYS.has(envKey)) {
    for (const dir of OPTIONAL_CONFIG_EXTRA_DIRS) {
      if (!dirs.includes(dir)) dirs.push(dir)
    }
  }

  for (const dir of dirs) {
    const candidate = path.join(dir, fileName)
    if (fs.existsSync(candidate)) return candidate
  }

  return explicit ?? (secretsDir ? path.join(secretsDir, fileName) : null)
}

/** Загружает секреты из файлов в process.env. */
export function loadSecretsFromFiles(): void {
  const secretsDir = resolveSecretsDir()

  for (const { envKey, fileEnvKey, fileName } of SECRET_MAPPINGS) {
    const current = process.env[envKey]?.trim()
    // Не перезаписываем явно заданный env, кроме дефолта localhost из compose
    if (current && !(envKey === 'SERVER_PUBLIC_IP' && current === '127.0.0.1')) {
      continue
    }

    // В Docker-стеке с локальной БД подключение идёт через DB_HOST/DB_PASSWORD
    if (envKey === 'DATABASE_URL' && process.env.DB_MODE === 'local') {
      continue
    }

    const filePath = resolveSecretFilePath(envKey, fileEnvKey, fileName, secretsDir)

    if (!filePath) continue

    if (!fs.existsSync(filePath)) continue

    const required =
      process.env.NODE_ENV === 'production' &&
      Boolean(process.env[fileEnvKey]) &&
      REQUIRED_IN_PRODUCTION.has(envKey)
    const value = readSecretFile(filePath, required)
    if (value !== null) {
      if (value === 'REPLACE_WITH_RANDOM_64_HEX_CHARS') {
        console.warn(`[Secrets] ${envKey}: в файле ${filePath} остался шаблон — замените на реальный ключ`)
      } else {
        process.env[envKey] = value
        if (OPTIONAL_CONFIG_KEYS.has(envKey)) {
          console.log(`[Secrets] ${envKey} загружен из ${filePath}`)
        }
      }
    }
  }
}
