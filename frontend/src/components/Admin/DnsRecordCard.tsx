import { useState } from 'react'
import styles from './DnsRecordCard.module.css'
import type { DnsRecord } from '@/types'

interface DnsRecordCardProps {
  record: DnsRecord
}

function statusLabel(status: DnsRecord['status']): string {
  if (status === 'verified') return '✅ Подтверждено'
  if (status === 'failed') return '❌ Ошибка'
  return '⏳ Ожидание'
}

function statusClass(status: DnsRecord['status']): string {
  if (status === 'verified') return styles.badgeOk
  if (status === 'failed') return styles.badgeFail
  return styles.badgePending
}

function valueToCopy(record: DnsRecord): string {
  if (record.type === 'MX') {
    return record.value.replace(/\s*\([^)]*\)\s*$/, '').trim()
  }
  if (record.type === 'PTR' && record.value.includes('(сейчас:')) {
    return record.value.split('(сейчас:')[0].trim()
  }
  return record.value
}

export function DnsRecordCard({ record }: DnsRecordCardProps) {
  const [copied, setCopied] = useState(false)

  async function copyValue() {
    await navigator.clipboard.writeText(valueToCopy(record))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <strong>{record.type}</strong>
        <span className={statusClass(record.status)}>{statusLabel(record.status)}</span>
      </div>
      <div className={styles.hint}>{record.description}</div>
      <div>
        <strong>Имя:</strong> {record.name}
      </div>
      <div className={styles.mono}>{record.value}</div>
      <button
        type="button"
        className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`}
        onClick={() => void copyValue()}
        title={copied ? 'Скопировано' : 'Копировать значение'}
        aria-label={copied ? 'Скопировано' : 'Копировать значение'}
      >
        {copied ? (
          <svg className={styles.copyIcon} viewBox="0 0 24 24" aria-hidden>
            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
          </svg>
        ) : (
          <svg className={styles.copyIcon} viewBox="0 0 24 24" aria-hidden>
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
          </svg>
        )}
      </button>
    </div>
  )
}
