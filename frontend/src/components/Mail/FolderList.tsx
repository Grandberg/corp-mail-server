import { useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { Folder } from '@/types'
import { api } from '@/services/api'
import styles from './FolderList.module.css'

interface FolderListProps {
  folders: Folder[]
  onBeforeNavigate?: () => void | Promise<void>
}

function FolderIcon({ folderId }: { folderId: string }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (folderId) {
    case 'inbox':
      return (
        <svg {...props}>
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      )
    case 'starred':
      return (
        <svg {...props} className={styles.folderIconStarred}>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      )
    case 'sent':
      return (
        <svg {...props}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      )
    case 'drafts':
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...props}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      )
    case 'spam':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      )
    case 'scheduled':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      )
    default:
      return (
        <svg {...props}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      )
  }
}

export function FolderList({ folders, onBeforeNavigate }: FolderListProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { folder: currentFolder = 'inbox' } = useParams()
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    await api.createFolder(name)
    setNewName('')
    setAdding(false)
    await queryClient.invalidateQueries({ queryKey: ['folders'] })
  }

  return (
    <nav className={styles.folderList}>
      {folders.map((folder) => (
        <NavLink
          key={folder.id}
          to={`/mail/${folder.id}`}
          onClick={(e) => {
            if (!onBeforeNavigate) return
            e.preventDefault()
            void Promise.resolve(onBeforeNavigate()).then(() => navigate(`/mail/${folder.id}`))
          }}
          className={({ isActive }) =>
            `${styles.folderItem} ${isActive || currentFolder === folder.id ? styles.folderActive : ''}`
          }
        >
          <span className={styles.folderLabel}>
            <span className={styles.folderIcon}>
              <FolderIcon folderId={folder.id} />
            </span>
            <span className={styles.folderName}>{folder.name}</span>
          </span>
          {folder.id === 'spam' ? (
            <span className={styles.spamBadge}>{folder.total_count}</span>
          ) : folder.id === 'drafts' || folder.id === 'trash' || folder.id === 'scheduled' ? (
            folder.total_count > 0 && (
              <span className={styles.spamBadge}>{folder.total_count}</span>
            )
          ) : (
            folder.unread_count > 0 && (
              <span className={styles.badge}>{folder.unread_count}</span>
            )
          )}
        </NavLink>
      ))}

      <div className={styles.createRow}>
        {adding ? (
          <>
            <input
              className={styles.createInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Имя папки"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
              }}
            />
            <button type="button" className={styles.createBtn} onClick={() => void handleCreate()}>
              OK
            </button>
          </>
        ) : (
          <button type="button" className={styles.addFolderBtn} onClick={() => setAdding(true)}>
            + Папка
          </button>
        )}
      </div>
    </nav>
  )
}
