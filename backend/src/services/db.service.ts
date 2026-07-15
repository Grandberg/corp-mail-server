import { Pool } from 'pg'
import { env } from '../config/env'

const POOL_CONNECT_TIMEOUT_MS = 30_000

let pool: Pool | undefined

export function getPool(): Pool {
  if (!pool) {
    if (env.DB_MODE === 'external') {
      let connectionString = env.DATABASE_URL
      if (!connectionString) {
        connectionString = `postgresql://${env.DB_USER}:${encodeURIComponent(env.DB_PASSWORD)}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`
      }
      if (!connectionString.includes('://')) {
        connectionString = `postgresql://${connectionString}`
      }
      const maskedUrl = connectionString.replace(/:([^@]+)@/, ':****@')
      console.log(`[DB] Connecting to external DB: ${maskedUrl}`)
      pool = new Pool({ connectionString, connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS })
    } else {
      console.log(
        `[DB] Connecting to local DB: ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME} (user=${env.DB_USER})`,
      )
      pool = new Pool({
        host: env.DB_HOST,
        port: env.DB_PORT,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
      })
    }
  }
  return pool
}

export interface WaitForDatabaseOptions {
  maxAttempts?: number
  delayMs?: number
}

/** Ждёт доступности PostgreSQL с повторами (нужно при старте Docker-стека). */
export async function waitForDatabase(options: WaitForDatabaseOptions = {}): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 30
  const delayMs = options.delayMs ?? 2_000

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const client = await getPool().connect()
      await client.query('SELECT 1')
      client.release()
      if (attempt > 1) {
        console.log(`[DB] Connected on attempt ${attempt}/${maxAttempts}`)
      }
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[DB] Not ready (attempt ${attempt}/${maxAttempts}): ${message}`)
      if (attempt === maxAttempts) {
        throw new Error(
          `Database unavailable after ${maxAttempts} attempts (${env.DB_MODE} → ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME})`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

export async function checkDbConnection(): Promise<boolean> {
  try {
    const client = await getPool().connect()
    await client.query('SELECT 1')
    client.release()
    return true
  } catch {
    return false
  }
}

async function runMigrationStep(name: string, sql: string): Promise<void> {
  await getPool().query(sql)
  console.log(`[DB] Migration applied: ${name}`)
}

export async function runMigrations(): Promise<void> {
  console.log('[DB] Running migrations...')
  await waitForDatabase()

  await runMigrationStep('001_domains', `
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS domains (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      domain_name VARCHAR(255) NOT NULL UNIQUE,
      is_active BOOLEAN DEFAULT false,
      is_verified BOOLEAN DEFAULT false,
      mx_verified BOOLEAN DEFAULT false,
      spf_verified BOOLEAN DEFAULT false,
      dkim_verified BOOLEAN DEFAULT false,
      dmarc_verified BOOLEAN DEFAULT false,
      dkim_private_key TEXT,
      dkim_public_key TEXT,
      dkim_selector VARCHAR(63) DEFAULT 'mail',
      max_users INTEGER DEFAULT 0,
      max_mailbox_size_mb INTEGER DEFAULT 1024,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  await runMigrationStep('002_users', `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      avatar_url TEXT,
      domain_id UUID REFERENCES domains(id) ON DELETE CASCADE,
      role VARCHAR(20) DEFAULT 'user',
      is_active BOOLEAN DEFAULT true,
      quota_used_bytes BIGINT DEFAULT 0,
      quota_max_bytes BIGINT DEFAULT 1073741824,
      signature_html TEXT,
      auto_reply_enabled BOOLEAN DEFAULT false,
      auto_reply_subject VARCHAR(255),
      auto_reply_body TEXT,
      totp_secret VARCHAR(64),
      totp_enabled BOOLEAN DEFAULT false,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(255) NOT NULL,
      ip_address INET,
      user_agent TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `)

  await runMigrationStep('003_emails', `
    CREATE TABLE IF NOT EXISTS emails (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id VARCHAR(255),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      domain_id UUID REFERENCES domains(id),
      folder VARCHAR(50) DEFAULT 'inbox',
      from_address VARCHAR(255) NOT NULL,
      from_name VARCHAR(255),
      to_addresses JSONB DEFAULT '[]',
      cc_addresses JSONB DEFAULT '[]',
      bcc_addresses JSONB DEFAULT '[]',
      subject TEXT,
      body_text TEXT,
      body_html TEXT,
      is_read BOOLEAN DEFAULT false,
      is_starred BOOLEAN DEFAULT false,
      is_flagged BOOLEAN DEFAULT false,
      in_reply_to VARCHAR(255),
      "references" JSONB DEFAULT '[]',
      headers JSONB,
      raw_source TEXT,
      size_bytes INTEGER DEFAULT 0,
      spam_score REAL,
      has_attachments BOOLEAN DEFAULT false,
      received_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_emails_user_folder ON emails(user_id, folder);
    CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);
    CREATE INDEX IF NOT EXISTS idx_emails_received ON emails(received_at DESC);

    CREATE TABLE IF NOT EXISTS attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      content_type VARCHAR(127),
      size_bytes INTEGER DEFAULT 0,
      storage_path TEXT NOT NULL,
      content_id VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments(email_id);
  `)

  await runMigrationStep('004_folders_contacts', `
    CREATE TABLE IF NOT EXISTS folders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0,
      color VARCHAR(7),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

    CREATE TABLE IF NOT EXISTS contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      phone VARCHAR(50),
      company VARCHAR(255),
      position VARCHAR(255),
      notes TEXT,
      avatar_url TEXT,
      is_shared BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_domain_shared ON contacts(domain_id, is_shared);
    CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);

    CREATE TABLE IF NOT EXISTS contact_groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      is_shared BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contact_group_members (
      contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      group_id UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (contact_id, group_id)
    );
  `)

  await runMigrationStep('005_rules_aliases_audit', `
    CREATE TABLE IF NOT EXISTS email_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      conditions JSONB NOT NULL,
      actions JSONB NOT NULL,
      is_active BOOLEAN DEFAULT true,
      priority INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rules_user ON email_rules(user_id);

    CREATE TABLE IF NOT EXISTS aliases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      source_address VARCHAR(255) NOT NULL,
      destination_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(source_address)
    );

    CREATE TABLE IF NOT EXISTS domain_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      key VARCHAR(255) NOT NULL,
      value TEXT,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(domain_id, key)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL,
      target_type VARCHAR(50),
      target_id UUID,
      details JSONB,
      ip_address INET,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
  `)

  await runMigrationStep('006_attachments_pending', `
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE attachments ALTER COLUMN email_id DROP NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_id);
  `)

  await runMigrationStep('007_domain_dns_status', `
    ALTER TABLE domains ADD COLUMN IF NOT EXISTS a_verified BOOLEAN DEFAULT false;
    ALTER TABLE domains ADD COLUMN IF NOT EXISTS dns_checked_at TIMESTAMPTZ;
    UPDATE domains
    SET a_verified = is_verified,
        dns_checked_at = COALESCE(dns_checked_at, updated_at)
    WHERE is_verified = true AND dns_checked_at IS NULL;
  `)

  await runMigrationStep('008_user_avatar_path', `
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT;
  `)

  await runMigrationStep('009_scheduled_send', `
    ALTER TABLE emails ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_emails_scheduled ON emails(scheduled_at) WHERE scheduled_at IS NOT NULL AND folder = 'scheduled';
  `)

  await runMigrationStep('010_telegram_integration', `
    CREATE TABLE IF NOT EXISTS system_settings (
      key VARCHAR(255) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_phone VARCHAR(50);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(50);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_notifications_enabled BOOLEAN DEFAULT false;

    ALTER TABLE emails ADD COLUMN IF NOT EXISTS telegram_message_id VARCHAR(50);
  `)

  await runMigrationStep('011_email_plaintext', `
    ALTER TABLE emails ADD COLUMN IF NOT EXISTS is_plain_text BOOLEAN DEFAULT false;
  `)

  await runMigrationStep('012_user_group_by_contacts', `
    ALTER TABLE users ADD COLUMN IF NOT EXISTS group_by_contacts BOOLEAN DEFAULT false;
  `)

  console.log('[DB] Migrations complete')
}

