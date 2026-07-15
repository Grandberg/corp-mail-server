const FOLDER_NAMES: Record<string, string> = {
  inbox: 'Входящие',
  starred: 'Помеченные',
  sent: 'Отправленные',
  drafts: 'Черновики',
  trash: 'Корзина',
  spam: 'Спам',
  scheduled: 'Запланировано',
}

export function folderDisplayName(folderId: string, fallbackName?: string): string {
  return FOLDER_NAMES[folderId] ?? fallbackName ?? folderId
}
