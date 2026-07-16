import {
  forwardRef,
  KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { api } from '@/services/api'
import type { EmailAddress, RecipientSuggestion } from '@/types'
import styles from './RecipientInput.module.css'

export interface RecipientInputHandle {
  /** Добавляет текст из поля в список и возвращает итоговый массив */
  commitPending: () => EmailAddress[]
}

interface RecipientInputProps {
  id?: string
  value: EmailAddress[]
  onChange: (value: EmailAddress[]) => void
  placeholder?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseSingleAddress(raw: string): EmailAddress | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const bracket = trimmed.match(/^(.+?)\s*<([^>]+)>$/)
  const email = (bracket ? bracket[2] : trimmed).trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return null

  let name: string | null = null
  if (bracket) {
    name = bracket[1].trim().replace(/^["']|["']$/g, '') || null
  }

  return { email, name }
}

function parseRaw(raw: string): EmailAddress[] {
  return raw
    .split(/[,;]/)
    .map((part) => parseSingleAddress(part))
    .filter((addr): addr is EmailAddress => addr !== null)
}

function mergeAddresses(current: EmailAddress[], extra: EmailAddress[]): EmailAddress[] {
  const result = [...current]
  for (const addr of extra) {
    const key = addr.email.toLowerCase()
    if (!result.some((v) => v.email.toLowerCase() === key)) {
      result.push({ ...addr, email: key })
    }
  }
  return result
}

export const RecipientInput = forwardRef<RecipientInputHandle, RecipientInputProps>(
  function RecipientInput({ id, value, onChange, placeholder }, ref) {
    const [query, setQuery] = useState('')
    const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([])
    const [open, setOpen] = useState(false)
    const valueRef = useRef(value)
    const queryRef = useRef(query)

    valueRef.current = value
    queryRef.current = query

    useEffect(() => {
      if (query.trim().length < 1) {
        setSuggestions([])
        return
      }
      const timer = window.setTimeout(() => {
        void api.searchRecipients(query).then(setSuggestions).catch(() => setSuggestions([]))
      }, 200)
      return () => window.clearTimeout(timer)
    }, [query])

    function commitPending(): EmailAddress[] {
      const trimmed = queryRef.current.trim()
      if (!trimmed) return valueRef.current

      const parsed = parseRaw(trimmed)
      if (parsed.length === 0) return valueRef.current

      const merged = mergeAddresses(valueRef.current, parsed)
      onChange(merged)
      setQuery('')
      setOpen(false)
      return merged
    }

    useImperativeHandle(ref, () => ({ commitPending }), [onChange])

    function addAddress(addr: EmailAddress) {
      onChange(mergeAddresses(valueRef.current, [addr]))
      setQuery('')
      setOpen(false)
    }

    function removeAt(index: number) {
      onChange(valueRef.current.filter((_, i) => i !== index))
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
      if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
        e.preventDefault()
        commitPending()
      }
      if (e.key === 'Backspace' && !query && value.length > 0) {
        removeAt(value.length - 1)
      }
    }

    return (
      <div className={styles.wrapper}>
        <div className={styles.inputRow}>
          {value.map((addr, index) => (
            <span key={`${addr.email}-${index}`} className={styles.chip}>
              {addr.name ? `${addr.name} <${addr.email}>` : addr.email}
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => removeAt(index)}
                aria-label="Удалить"
              >
                ×
              </button>
            </span>
          ))}
          <input
            id={id}
            type="search"
            autoComplete="no-autofill-suggestions"
            className={styles.textInput}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              commitPending()
              window.setTimeout(() => setOpen(false), 100)
            }}
            onKeyDown={onKeyDown}
            placeholder={value.length === 0 && !query ? placeholder : ''}
          />
        </div>
        {open && suggestions.length > 0 && (
          <div className={styles.suggestions}>
            {suggestions.map((s) => (
              <button
                key={s.email}
                type="button"
                className={styles.suggestion}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addAddress({ email: s.email, name: s.name })}
              >
                <div>{s.name ? `${s.name} <${s.email}>` : s.email}</div>
                <div className={styles.suggestionMeta}>
                  {s.source === 'contact' ? 'Контакт' : 'Пользователь домена'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  },
)
