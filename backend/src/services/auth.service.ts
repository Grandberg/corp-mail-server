import bcrypt from 'bcryptjs'
import jwt, { type SignOptions } from 'jsonwebtoken'
import type { PoolClient } from 'pg'
import { env } from '../config/env'
import type { UserRole } from '../config/constants'
import { getPool } from './db.service'
import { extractDomainFromEmail } from '../utils/emailDomain'
import type { PublicUser, UserRecord } from '../types/user'
import { toPublicUser } from '../types/user'

const SALT_ROUNDS = 12

export async function getUsersCount(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users')
  return Number(rows[0]?.count ?? 0)
}

export async function isFirstRun(): Promise<boolean> {
  return (await getUsersCount()) === 0
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const { rows } = await getPool().query<UserRecord>(
    `SELECT id, email, password_hash, display_name, avatar_url, domain_id, role, is_active, created_at
     FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email.trim()],
  )
  return rows[0] ?? null
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const { rows } = await getPool().query<UserRecord>(
    `SELECT id, email, password_hash, display_name, avatar_url, domain_id, role, is_active, created_at
     FROM users WHERE id = $1 LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

async function findOrCreateDomain(client: PoolClient, domainName: string, activate: boolean): Promise<string> {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM domains WHERE LOWER(domain_name) = LOWER($1) LIMIT 1',
    [domainName],
  )
  if (existing.rows[0]) {
    if (activate) {
      await client.query(
        'UPDATE domains SET is_active = true, updated_at = NOW() WHERE id = $1',
        [existing.rows[0].id],
      )
    }
    return existing.rows[0].id
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO domains (domain_name, is_active, is_verified)
     VALUES ($1, $2, false)
     RETURNING id`,
    [domainName, activate],
  )
  return created.rows[0].id
}

export interface CreateUserInput {
  email: string
  password: string
  displayName?: string
  role?: UserRole
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase()
  const domainName = extractDomainFromEmail(email)
  if (!domainName) {
    throw new Error('Invalid email address')
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS)
  const usersCount = await getUsersCount()
  const isFirst = usersCount === 0

  const role: UserRole = isFirst ? 'superadmin' : (input.role ?? 'user')

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    const domainId = await findOrCreateDomain(client, domainName, isFirst)

    const { rows } = await client.query<UserRecord>(
      `INSERT INTO users (email, password_hash, display_name, domain_id, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, email, password_hash, display_name, avatar_url, domain_id, role, is_active, created_at`,
      [email, passwordHash, input.displayName?.trim() || null, domainId, role],
    )

    await client.query('COMMIT')
    return toPublicUser(rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function verifyPassword(user: UserRecord, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.password_hash)
}

export async function updateLastLogin(userId: string): Promise<void> {
  await getPool().query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId])
}

export function issueToken(userId: string, email: string): { token: string; expiresIn: string } {
  const signOptions: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  }
  const token = jwt.sign({ sub: userId, email }, env.JWT_SECRET, signOptions)
  return { token, expiresIn: env.JWT_EXPIRES_IN }
}
