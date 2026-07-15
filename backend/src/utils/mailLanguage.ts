/** Определяет язык письма по тексту (без внешних библиотек). Возвращает null, если не уверены. */
export function detectMailLanguage(text: string): string | null {
  const sample = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)

  if (sample.length < 12) return null

  let cyrillic = 0
  let latin = 0
  let otherLetter = 0

  for (const ch of sample) {
    if (/[\u0400-\u04FF]/.test(ch)) cyrillic++
    else if (/[a-zA-Z]/.test(ch)) latin++
    else if (/\p{L}/u.test(ch)) otherLetter++
  }

  const letters = cyrillic + latin + otherLetter
  if (letters < 8) return null

  if (cyrillic / letters >= 0.55) return 'ru'
  if (latin / letters >= 0.55) return 'en'
  return null
}
