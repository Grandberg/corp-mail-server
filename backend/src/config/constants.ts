export const ROLES = ['superadmin', 'admin', 'user'] as const
export type UserRole = (typeof ROLES)[number]

export const SYSTEM_FOLDERS = ['inbox', 'sent', 'drafts', 'trash', 'spam', 'scheduled'] as const
export type SystemFolder = (typeof SYSTEM_FOLDERS)[number]

/** Виртуальная папка — фильтр по is_starred, не хранится в emails.folder. */
export const VIRTUAL_FOLDERS = ['starred'] as const
export type VirtualFolder = (typeof VIRTUAL_FOLDERS)[number]

export const DEFAULT_ATTACHMENT_SIZE = 26_214_400 // 25 MB
