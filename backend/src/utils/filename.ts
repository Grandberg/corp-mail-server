import path from 'node:path'

const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.scr',
  '.ps1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.jar',
  '.app',
  '.deb',
  '.rpm',
  '.dmg',
  '.sh',
  '.bash',
  '.cpl',
  '.inf',
  '.reg',
  '.dll',
  '.sys',
  '.drv',
  '.hta',
  '.msc',
  '.pif',
])

const BLOCKED_MIME_PREFIXES = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/vnd.microsoft.portable-executable',
]

/** Имя для отображения: кириллица и Unicode-буквы сохраняются. */
export function sanitizeDisplayFilename(originalName: string): string {
  const base = path.basename(originalName).replace(/[/\\]/g, '')
  const cleaned = base
    .replace(/[^\p{L}\p{N}.\-() _]/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return cleaned || 'file'
}

/** Имя файла на диске: UUID + расширение (безопасно для ФС). */
export function buildStorageFilename(attachmentId: string, displayName: string): string {
  const ext = path.extname(displayName).slice(0, 16)
  return `${attachmentId}${ext}`
}

export function isBlockedExecutable(filename: string, mimeType?: string | null): boolean {
  const ext = path.extname(filename).toLowerCase()
  if (BLOCKED_EXTENSIONS.has(ext)) return true
  if (!mimeType) return false
  const lower = mimeType.toLowerCase()
  return BLOCKED_MIME_PREFIXES.some((p) => lower.startsWith(p))
}
