import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useEmailStore } from '@/store/emailStore'
import styles from './AppHeader.module.css'

export function AppHeader() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { searchQuery, setSearchQuery } = useEmailStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const mailboxName = user?.display_name?.trim() || user?.email || 'Почта'
  const logoName = user?.email || 'Почта'
  const showMailSearch = location.pathname.startsWith('/mail')

  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const [copied, setCopied] = useState(false)

  function go(path: string) {
    setMenuOpen(false)
    navigate(path)
  }

  return (
    <header className={styles.header}>
      <div className={styles.logoWrap}>
        <Link to="/mail/inbox" className={styles.logo}>
          <img src="/app_icon.png" alt="Logo" className={styles.logoIcon} />
          <span className={styles.logoText}>{logoName}</span>
        </Link>
        {user?.email && (
          <button
            type="button"
            className={styles.copyEmailBtn}
            title="Копировать имейл в буфер обмена"
            onClick={async (e) => {
              e.preventDefault()
              e.stopPropagation()
              try {
                await navigator.clipboard.writeText(user.email)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              } catch (err) {
                // ignore
              }
            }}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.copiedIcon}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        )}
      </div>

      {showMailSearch && (
        <div className={styles.searchWrap}>
          <svg
            className={styles.searchIcon}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Поиск по всем папкам…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Поиск писем"
          />
        </div>
      )}

      <div className={styles.menuWrap} ref={menuRef}>
        <button
          type="button"
          className={styles.gearBtn}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Меню"
          aria-expanded={menuOpen}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {menuOpen && (
          <div className={styles.dropdown}>
            <div className={styles.userCard}>
              {user?.avatar_url ? (
                <img className={styles.avatar} src={user.avatar_url} alt="Аватар" />
              ) : (
                <div className={styles.avatarPlaceholder}>
                  {mailboxName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className={styles.userInfo}>
                <span className={styles.userName}>{mailboxName}</span>
                {user?.email && <span className={styles.userEmail}>{user.email}</span>}
              </div>
            </div>

            <div className={styles.divider} />

            <button type="button" className={styles.menuItem} onClick={() => go('/settings')}>
              Настройки
            </button>
            {isAdmin && (
              <button type="button" className={styles.menuItem} onClick={() => go('/admin')}>
                Администрирование
              </button>
            )}

            <div className={styles.divider} />

            <button
              type="button"
              className={`${styles.menuItem} ${styles.logoutItem}`}
              onClick={handleLogout}
            >
              Выйти
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
