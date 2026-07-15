import { getPool } from './db.service'
import { SYSTEM_FOLDERS, VIRTUAL_FOLDERS, type SystemFolder } from '../config/constants'
import type { FolderInfo } from '../types/email'

function isSystemFolder(folder: string): folder is SystemFolder {
  return (SYSTEM_FOLDERS as readonly string[]).includes(folder)
}

function isVirtualFolder(folder: string): boolean {
  return (VIRTUAL_FOLDERS as readonly string[]).includes(folder)
}

export async function listFolders(userId: string): Promise<FolderInfo[]> {
  const systemCounts = await getPool().query<{
    folder: string
    unread_count: string
    total_count: string
  }>(
    `SELECT folder,
            COUNT(*) FILTER (WHERE NOT is_read)::text AS unread_count,
            COUNT(*)::text AS total_count
     FROM emails
     WHERE user_id = $1 AND folder = ANY($2::text[])
     GROUP BY folder`,
    [userId, [...SYSTEM_FOLDERS]],
  )

  const countMap = new Map(
    systemCounts.rows.map((r) => [
      r.folder,
      { unread: Number(r.unread_count), total: Number(r.total_count) },
    ]),
  )

  const starredCounts = await getPool().query<{
    unread_count: string
    total_count: string
  }>(
    `SELECT COUNT(*) FILTER (WHERE NOT is_read)::text AS unread_count,
            COUNT(*)::text AS total_count
     FROM emails
     WHERE user_id = $1 AND is_starred = true AND folder NOT IN ('trash', 'spam')`,
    [userId],
  )
  const starredRow = starredCounts.rows[0]

  const systemFolders: FolderInfo[] = []
  for (const id of SYSTEM_FOLDERS) {
    systemFolders.push({
      id,
      name: folderDisplayName(id),
      type: 'system',
      unread_count: countMap.get(id)?.unread ?? 0,
      total_count: countMap.get(id)?.total ?? 0,
    })
    if (id === 'inbox') {
      systemFolders.push({
        id: 'starred',
        name: folderDisplayName('starred'),
        type: 'system',
        unread_count: Number(starredRow?.unread_count ?? 0),
        total_count: Number(starredRow?.total_count ?? 0),
      })
    }
  }

  const custom = await getPool().query<{
    id: string
    name: string
    color: string | null
    parent_id: string | null
    unread_count: string
    total_count: string
  }>(
    `SELECT f.id, f.name, f.color, f.parent_id,
            COALESCE(ec.unread_count, 0)::text AS unread_count,
            COALESCE(ec.total_count, 0)::text AS total_count
     FROM folders f
     LEFT JOIN (
       SELECT folder::text AS folder_id,
              COUNT(*) FILTER (WHERE NOT is_read) AS unread_count,
              COUNT(*) AS total_count
       FROM emails
       WHERE user_id = $1
       GROUP BY folder
     ) ec ON ec.folder_id = f.id::text
     WHERE f.user_id = $1
     ORDER BY f.sort_order, f.name`,
    [userId],
  )

  const customFolders: FolderInfo[] = custom.rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: 'custom',
    unread_count: Number(row.unread_count),
    total_count: Number(row.total_count),
    color: row.color,
    parent_id: row.parent_id,
  }))

  return [...systemFolders, ...customFolders]
}

export async function createFolder(userId: string, name: string, color?: string): Promise<FolderInfo> {
  const { rows } = await getPool().query<{ id: string; name: string; color: string | null }>(
    `INSERT INTO folders (user_id, name, color)
     VALUES ($1, $2, $3)
     RETURNING id, name, color`,
    [userId, name.trim(), color ?? null],
  )
  return {
    id: rows[0].id,
    name: rows[0].name,
    type: 'custom',
    unread_count: 0,
    total_count: 0,
    color: rows[0].color,
  }
}

export async function updateFolder(
  userId: string,
  folderId: string,
  name: string,
): Promise<FolderInfo | null> {
  const { rows } = await getPool().query<{ id: string; name: string; color: string | null }>(
    `UPDATE folders SET name = $3
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, color`,
    [folderId, userId, name.trim()],
  )
  if (!rows[0]) return null
  return {
    id: rows[0].id,
    name: rows[0].name,
    type: 'custom',
    unread_count: 0,
    total_count: 0,
    color: rows[0].color,
  }
}

export async function deleteFolder(userId: string, folderId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'DELETE FROM folders WHERE id = $1 AND user_id = $2',
    [folderId, userId],
  )
  return (rowCount ?? 0) > 0
}

export function folderDisplayName(folder: string): string {
  const names: Record<string, string> = {
    inbox: 'Входящие',
    starred: 'Помеченные',
    sent: 'Отправленные',
    drafts: 'Черновики',
    trash: 'Корзина',
    spam: 'Спам',
    scheduled: 'Запланировано',
  }
  return names[folder] ?? folder
}

export function validateFolderId(folder: string): boolean {
  return isVirtualFolder(folder) || isSystemFolder(folder) || /^[0-9a-f-]{36}$/i.test(folder)
}
