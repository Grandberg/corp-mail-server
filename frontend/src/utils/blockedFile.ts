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

export function isBlockedExecutableFile(file: File): boolean {
  const name = file.name.toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return BLOCKED_EXTENSIONS.has(name.slice(dot))
}
