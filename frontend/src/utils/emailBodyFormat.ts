const BLOCK_TAGS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'tr',
  'blockquote',
  'pre',
])

/** HTML → plain text с сохранением переносов строк по блокам и <br>. */
export function htmlToPlainLines(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const lines: string[] = []

  function inlineToText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? ''
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    if (el.tagName.toLowerCase() === 'br') return '\n'
    return Array.from(el.childNodes).map(inlineToText).join('')
  }

  function pushBlock(el: Element) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') {
      lines.push('')
      return
    }
    if (tag === 'li') {
      lines.push(`- ${inlineToText(el)}`)
      return
    }
    if (BLOCK_TAGS.has(tag)) {
      const parts = inlineToText(el).split('\n')
      if (parts.length === 0) {
        lines.push('')
      } else {
        for (const part of parts) lines.push(part)
      }
      return
    }
    for (const child of Array.from(el.children)) {
      pushBlock(child as Element)
    }
  }

  for (const child of Array.from(doc.body.children)) {
    pushBlock(child as Element)
  }

  if (lines.length === 0) {
    return inlineToText(doc.body).replace(/\r\n/g, '\n')
  }

  return lines.join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Plain text (по строкам) → простой HTML без стилей. */
export function plainLinesToHtml(text: string): string {
  const lines = text.split('\n')
  if (lines.length === 0) return '<p></p>'
  return lines
    .map((line) => {
      const trimmed = line.trimEnd()
      if (!trimmed) return '<p><br></p>'
      return `<p>${escapeHtml(trimmed)}</p>`
    })
    .join('')
}
