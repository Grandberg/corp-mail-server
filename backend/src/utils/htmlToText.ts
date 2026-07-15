const BLOCK_CLOSE_TAG = /<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const isHex = code[1]?.toLowerCase() === 'x'
      const num = isHex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isNaN(num) ? match : String.fromCodePoint(num)
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

/**
 * HTML → plain text для multipart/alternative. Сохраняет разбиение на строки/абзацы
 * по блочным элементам и <br> — почтовые провайдеры и антиспам-фильтры оценивают
 * читаемость text/plain части; «стена текста» без переносов — сигнал низкого качества.
 */
export function htmlToText(html: string): string {
  let normalized = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_CLOSE_TAG, '\n')
    .replace(/<[^>]+>/g, '')

  normalized = decodeEntities(normalized)

  const lines = normalized
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())

  const collapsed: string[] = []
  for (const line of lines) {
    if (line === '' && collapsed[collapsed.length - 1] === '') continue
    collapsed.push(line)
  }

  return collapsed.join('\n').trim()
}
