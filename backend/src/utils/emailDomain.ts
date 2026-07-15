/** Извлекает домен из email-адреса: user@domain.com → domain.com */
export function extractDomainFromEmail(email: string): string | null {
  const parts = email.trim().toLowerCase().split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return parts[1]
}
