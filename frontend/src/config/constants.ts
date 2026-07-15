export const API_URL = import.meta.env.VITE_API_URL ?? '/api'

export const DEFAULT_PAGE_SIZE = 50

export const SYSTEM_FOLDER_LABELS: Record<string, string> = {
  inbox: 'Входящие',
  sent: 'Отправленные',
  drafts: 'Черновики',
  trash: 'Корзина',
  spam: 'Спам',
  scheduled: 'Запланировано',
}
