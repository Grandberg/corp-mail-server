export function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  const now = new Date()
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()

  if (isToday) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function displaySender(fromName: string | null, fromAddress: string): string {
  return fromName?.trim() || fromAddress
}

export function emailPreview(text: string | null, max = 120): string {
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}
