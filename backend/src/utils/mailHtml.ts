/**
 * Схлопывает подряд идущие пустые блоки (<p><br></p>, <div><br></div> и т.п.) в один.
 * Несколько пустых строк подряд перед подписью выглядят как «шаблон» для антиспам-моделей
 * (характерно для рассылок) и просто раздувают письмо без пользы для читателя.
 */
export function collapseEmptyParagraphs(html: string): string {
  const emptyBlock = '(?:<p>(?:\\s|&nbsp;|<br\\s*\\/?>)*<\\/p>|<div>(?:\\s|&nbsp;|<br\\s*\\/?>)*<\\/div>)'
  const re = new RegExp(`(?:${emptyBlock}\\s*){2,}`, 'gi')
  return html.replace(re, (match) => (/^<div/i.test(match.trim()) ? '<div><br></div>' : '<p><br></p>'))
}

/** Обёртка HTML для исходящей почты. lang — только если язык определён. */
export function wrapHtmlForMail(html: string, lang?: string | null): string {
  const trimmed = html.trim()
  const langAttr = lang ? ` lang="${lang}"` : ''

  if (!trimmed) {
    return `<!DOCTYPE html><html${langAttr}><head><meta charset="utf-8"></head><body></body></html>`
  }

  if (/<html[\s>]/i.test(trimmed)) {
    if (lang && !/lang\s*=/i.test(trimmed)) {
      return trimmed.replace(/<html/i, `<html lang="${lang}"`)
    }
    return trimmed
  }

  return `<!DOCTYPE html><html${langAttr}><head><meta charset="utf-8"></head><body>${trimmed}</body></html>`
}
