import { getPool } from './db.service'
import { findUserById } from './auth.service'
import { getActorDomainScope } from '../utils/domainAccess'
import type { Contact, ContactGroup, RecipientSuggestion } from '../types/contact'

interface ContactRow {
  id: string
  domain_id: string
  owner_id: string | null
  email: string
  display_name: string | null
  phone: string | null
  company: string | null
  position: string | null
  notes: string | null
  is_shared: boolean
  created_at: Date
  updated_at: Date
}

function mapContact(row: ContactRow): Contact {
  return {
    id: row.id,
    domain_id: row.domain_id,
    owner_id: row.owner_id,
    email: row.email,
    display_name: row.display_name,
    phone: row.phone,
    company: row.company,
    position: row.position,
    notes: row.notes,
    is_shared: row.is_shared,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }
}

async function getUserDomainId(userId: string): Promise<string> {
  const user = await findUserById(userId)
  if (!user?.domain_id) throw new Error('User domain not found')
  return user.domain_id
}

export async function listContacts(userId: string): Promise<Contact[]> {
  const domainId = await getUserDomainId(userId)
  const { rows } = await getPool().query<ContactRow>(
    `SELECT id, domain_id, owner_id, email, display_name, phone, company, position, notes,
            is_shared, created_at, updated_at
     FROM contacts
     WHERE (domain_id = $1 AND is_shared = true) OR owner_id = $2
     ORDER BY COALESCE(display_name, email)`,
    [domainId, userId],
  )
  return rows.map(mapContact)
}

export async function searchRecipients(userId: string, query: string): Promise<RecipientSuggestion[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 1) return []

  const domainId = await getUserDomainId(userId)
  const like = `%${q}%`

  const [contactsRes, usersRes, emailsRes] = await Promise.all([
    getPool().query<{ email: string; display_name: string | null }>(
      `SELECT email, display_name FROM contacts
       WHERE ((domain_id = $1 AND is_shared = true) OR owner_id = $2)
          AND (LOWER(email) LIKE $3 OR LOWER(COALESCE(display_name, '')) LIKE $3)
       ORDER BY COALESCE(display_name, email)
       LIMIT 15`,
      [domainId, userId, like],
    ),
    getPool().query<{ email: string; display_name: string | null }>(
      `SELECT email, display_name FROM users
       WHERE domain_id = $1 AND is_active = true
         AND (LOWER(email) LIKE $2 OR LOWER(COALESCE(display_name, '')) LIKE $2)
       ORDER BY COALESCE(display_name, email)
       LIMIT 15`,
      [domainId, like],
    ),
    getPool().query<{ email: string; name: string | null }>(
      `WITH all_recipients AS (
         SELECT from_address AS email, from_name AS name
         FROM emails
         WHERE user_id = $1 AND (LOWER(from_address) LIKE $2 OR LOWER(COALESCE(from_name, '')) LIKE $2)
         
         UNION
         
         SELECT r.email, r.name
         FROM emails e,
              LATERAL jsonb_to_recordset(e.to_addresses) AS r(email text, name text)
         WHERE e.user_id = $1 AND (LOWER(r.email) LIKE $2 OR LOWER(COALESCE(r.name, '')) LIKE $2)
         
         UNION
         
         SELECT r.email, r.name
         FROM emails e,
              LATERAL jsonb_to_recordset(e.cc_addresses) AS r(email text, name text)
         WHERE e.user_id = $1 AND (LOWER(r.email) LIKE $2 OR LOWER(COALESCE(r.name, '')) LIKE $2)
         
         UNION
         
         SELECT r.email, r.name
         FROM emails e,
              LATERAL jsonb_to_recordset(e.bcc_addresses) AS r(email text, name text)
         WHERE e.user_id = $1 AND (LOWER(r.email) LIKE $2 OR LOWER(COALESCE(r.name, '')) LIKE $2)
       )
       SELECT email, name FROM all_recipients
       WHERE email IS NOT NULL AND email != ''
       LIMIT 30`,
      [userId, like],
    ),
  ])

  const seen = new Set<string>()
  const results: RecipientSuggestion[] = []

  for (const row of contactsRes.rows) {
    const key = row.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ email: row.email, name: row.display_name, source: 'contact' })
  }

  for (const row of usersRes.rows) {
    const key = row.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ email: row.email, name: row.display_name, source: 'user' })
  }

  for (const row of emailsRes.rows) {
    const key = row.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ email: row.email, name: row.name, source: 'contact' })
  }

  return results.slice(0, 20)
}

export interface CreateContactInput {
  email: string
  displayName?: string
  phone?: string
  company?: string
  position?: string
  notes?: string
  isShared?: boolean
}

export async function createContact(userId: string, input: CreateContactInput): Promise<Contact> {
  const actor = await getActorDomainScope(userId)
  const domainId = await getUserDomainId(userId)
  const isShared = Boolean(input.isShared)

  if (isShared && !actor.isSuperadmin && actor.role !== 'admin') {
    throw new Error('Only admin can create shared contacts')
  }

  const email = input.email.trim().toLowerCase()
  const { rows } = await getPool().query<ContactRow>(
    `INSERT INTO contacts (
       domain_id, owner_id, email, display_name, phone, company, position, notes, is_shared
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, domain_id, owner_id, email, display_name, phone, company, position, notes,
               is_shared, created_at, updated_at`,
    [
      domainId,
      isShared ? null : userId,
      email,
      input.displayName?.trim() || null,
      input.phone?.trim() || null,
      input.company?.trim() || null,
      input.position?.trim() || null,
      input.notes?.trim() || null,
      isShared,
    ],
  )
  return mapContact(rows[0])
}

export async function updateContact(
  userId: string,
  contactId: string,
  input: Partial<CreateContactInput>,
): Promise<Contact | null> {
  const existing = await getContactById(userId, contactId)
  if (!existing) return null

  const actor = await getActorDomainScope(userId)
  if (existing.is_shared && !actor.isSuperadmin && actor.role !== 'admin') {
    throw new Error('Only admin can edit shared contacts')
  }
  if (!existing.is_shared && existing.owner_id !== userId) {
    throw new Error('Contact not found')
  }

  if (input.isShared !== undefined && input.isShared && !actor.isSuperadmin && actor.role !== 'admin') {
    throw new Error('Only admin can make contacts shared')
  }

  const { rows } = await getPool().query<ContactRow>(
    `UPDATE contacts SET
       email = COALESCE($3, email),
       display_name = COALESCE($4, display_name),
       phone = COALESCE($5, phone),
       company = COALESCE($6, company),
       position = COALESCE($7, position),
       notes = COALESCE($8, notes),
       is_shared = COALESCE($9, is_shared),
       owner_id = CASE
         WHEN $9 = true THEN NULL
         WHEN $9 = false THEN $2
         ELSE owner_id
       END,
       updated_at = NOW()
     WHERE id = $1
     RETURNING id, domain_id, owner_id, email, display_name, phone, company, position, notes,
               is_shared, created_at, updated_at`,
    [
      contactId,
      userId,
      input.email?.trim().toLowerCase(),
      input.displayName?.trim(),
      input.phone?.trim(),
      input.company?.trim(),
      input.position?.trim(),
      input.notes?.trim(),
      input.isShared !== undefined ? input.isShared : null,
    ],
  )
  return rows[0] ? mapContact(rows[0]) : null
}

export async function deleteContact(userId: string, contactId: string): Promise<boolean> {
  const existing = await getContactById(userId, contactId)
  if (!existing) return false

  const actor = await getActorDomainScope(userId)
  if (existing.is_shared && !actor.isSuperadmin && actor.role !== 'admin') {
    throw new Error('Only admin can delete shared contacts')
  }
  if (!existing.is_shared && existing.owner_id !== userId) {
    return false
  }

  const { rowCount } = await getPool().query('DELETE FROM contacts WHERE id = $1', [contactId])
  return (rowCount ?? 0) > 0
}

async function getContactById(userId: string, contactId: string): Promise<Contact | null> {
  const domainId = await getUserDomainId(userId)
  const { rows } = await getPool().query<ContactRow>(
    `SELECT id, domain_id, owner_id, email, display_name, phone, company, position, notes,
            is_shared, created_at, updated_at
     FROM contacts
     WHERE id = $1 AND ((domain_id = $2 AND is_shared = true) OR owner_id = $3)`,
    [contactId, domainId, userId],
  )
  return rows[0] ? mapContact(rows[0]) : null
}

export async function listContactGroups(userId: string): Promise<ContactGroup[]> {
  const domainId = await getUserDomainId(userId)
  const { rows } = await getPool().query<{
    id: string
    domain_id: string
    owner_id: string | null
    name: string
    is_shared: boolean
    contact_count: string
    created_at: Date
  }>(
    `SELECT g.id, g.domain_id, g.owner_id, g.name, g.is_shared,
            COUNT(m.contact_id)::text AS contact_count, g.created_at
     FROM contact_groups g
     LEFT JOIN contact_group_members m ON m.group_id = g.id
     WHERE (g.domain_id = $1 AND g.is_shared = true) OR g.owner_id = $2
     GROUP BY g.id
     ORDER BY g.name`,
    [domainId, userId],
  )

  return rows.map((row) => ({
    id: row.id,
    domain_id: row.domain_id,
    owner_id: row.owner_id,
    name: row.name,
    is_shared: row.is_shared,
    contact_count: Number(row.contact_count),
    created_at: row.created_at.toISOString(),
  }))
}

export async function createContactGroup(
  userId: string,
  name: string,
  isShared = false,
): Promise<ContactGroup> {
  const actor = await getActorDomainScope(userId)
  const domainId = await getUserDomainId(userId)

  if (isShared && !actor.isSuperadmin && actor.role !== 'admin') {
    throw new Error('Only admin can create shared groups')
  }

  const { rows } = await getPool().query<{ id: string; created_at: Date }>(
    `INSERT INTO contact_groups (domain_id, owner_id, name, is_shared)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [domainId, isShared ? null : userId, name.trim(), isShared],
  )

  return {
    id: rows[0].id,
    domain_id: domainId,
    owner_id: isShared ? null : userId,
    name: name.trim(),
    is_shared: isShared,
    contact_count: 0,
    created_at: rows[0].created_at.toISOString(),
  }
}

export async function deleteContactGroup(userId: string, groupId: string): Promise<boolean> {
  const actor = await getActorDomainScope(userId)
  const domainId = await getUserDomainId(userId)

  const { rows } = await getPool().query<{ owner_id: string | null; is_shared: boolean }>(
    'SELECT owner_id, is_shared FROM contact_groups WHERE id = $1 AND domain_id = $2',
    [groupId, domainId],
  )
  if (!rows[0]) return false

  if (rows[0].is_shared && !actor.isSuperadmin && actor.role !== 'admin') {
    throw new Error('Only admin can delete shared groups')
  }
  if (!rows[0].is_shared && rows[0].owner_id !== userId) return false

  const { rowCount } = await getPool().query('DELETE FROM contact_groups WHERE id = $1', [groupId])
  return (rowCount ?? 0) > 0
}
