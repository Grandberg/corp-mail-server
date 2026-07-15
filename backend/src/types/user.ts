import type { UserRole } from '../config/constants'

export interface UserRecord {
  id: string
  email: string
  password_hash: string
  display_name: string | null
  avatar_url: string | null
  domain_id: string | null
  role: UserRole
  is_active: boolean
  created_at: Date
}

export interface PublicUser {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  domain_id: string | null
  role: UserRole
  is_active: boolean
}

export interface AdminUserListItem extends PublicUser {
  unread_count: number
  total_emails: number
  mailbox_size_bytes: number
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    domain_id: user.domain_id,
    role: user.role,
    is_active: user.is_active,
  }
}

export function toAdminUserListItem(
  user: UserRecord,
  stats: Pick<AdminUserListItem, 'unread_count' | 'total_emails' | 'mailbox_size_bytes'>,
): AdminUserListItem {
  return {
    ...toPublicUser(user),
    ...stats,
  }
}
