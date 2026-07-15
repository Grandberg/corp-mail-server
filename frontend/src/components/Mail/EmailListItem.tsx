import type { EmailListItem } from '@/types'
import { displaySender, emailPreview, formatDate } from '@/utils/formatDate'
import { folderDisplayName } from '@/utils/folderDisplay'
import styles from './EmailList.module.css'

interface EmailListItemProps {
  email: EmailListItem
  active: boolean
  selected: boolean
  showFolder?: boolean
  onSelect: (id: string) => void
  onToggleSelect: (id: string) => void
}

export function EmailListItemRow({
  email,
  active,
  selected,
  showFolder = false,
  onSelect,
  onToggleSelect,
}: EmailListItemProps) {
  const date = formatDate(email.received_at ?? email.sent_at ?? email.created_at)

  return (
    <div
      className={`${styles.item} ${active ? styles.itemActive : ''} ${!email.is_read ? styles.itemUnread : ''}`}
    >
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={selected}
        onChange={() => onToggleSelect(email.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Выбрать письмо"
      />
      <button type="button" className={styles.itemBtn} onClick={() => onSelect(email.id)}>
        <div className={styles.rowTop}>
          <span className={styles.sender}>
            {displaySender(email.from_name, email.from_address)}
          </span>
          <span className={styles.date}>{date}</span>
        </div>
        <div className={styles.subject}>{email.subject || '(без темы)'}</div>
        <div className={styles.preview}>{emailPreview(email.body_text)}</div>
        <div className={styles.meta}>
          {showFolder && (
            <span className={styles.folderTag}>{folderDisplayName(email.folder)}</span>
          )}
          {email.is_starred && <span className={styles.star}>★</span>}
          {email.has_attachments && <span className={styles.attach}>📎</span>}
        </div>
      </button>
    </div>
  )
}
