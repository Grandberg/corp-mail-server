import { NavLink, useParams } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { DomainManager } from './DomainManager'
import { UserManager } from './UserManager'
import { AliasManager } from './AliasManager'
import { SystemStats } from './SystemStats'
import { AuditLog } from './AuditLog'
import { DbConfig } from './DbConfig'
import { TelegramConfig } from './TelegramConfig'
import styles from './AdminPage.module.css'


const TABS = [
  { id: 'domains', label: 'Домены' },
  { id: 'users', label: 'Пользователи' },
  { id: 'aliases', label: 'Алиасы' },
  { id: 'system', label: 'Система' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'audit', label: 'Аудит' },
  { id: 'db', label: 'БД' },
] as const

type TabId = (typeof TABS)[number]['id']

export function AdminPage() {
  const { tab } = useParams()
  const user = useAuthStore((s) => s.user)
  const activeTab = (tab as TabId) || 'domains'
  const isSuperadmin = user?.role === 'superadmin'

  const visibleTabs = isSuperadmin
    ? TABS
    : TABS.filter((t) => t.id !== 'domains' && t.id !== 'db' && t.id !== 'telegram')


  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Администрирование</h1>

      <nav className={styles.tabs}>
        {visibleTabs.map((t) => (
          <NavLink
            key={t.id}
            to={`/admin/${t.id}`}
            className={({ isActive }) =>
              `${styles.tab} ${isActive || activeTab === t.id ? styles.tabActive : ''}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className={styles.panel}>
        {activeTab === 'domains' && isSuperadmin && <DomainManager />}
        {activeTab === 'domains' && !isSuperadmin && (
          <p className={styles.hint}>Управление доменами доступно только суперадмину.</p>
        )}
        {activeTab === 'users' && <UserManager />}
        {activeTab === 'aliases' && <AliasManager />}
        {activeTab === 'system' && <SystemStats />}
        {activeTab === 'audit' && <AuditLog />}
        {activeTab === 'telegram' && isSuperadmin && <TelegramConfig />}
        {activeTab === 'telegram' && !isSuperadmin && (
          <p className={styles.hint}>Настройки Telegram доступны только суперадмину.</p>
        )}
        {activeTab === 'db' && isSuperadmin && <DbConfig />}
        {activeTab === 'db' && !isSuperadmin && (
          <p className={styles.hint}>Настройки БД доступны только суперадмину.</p>
        )}
      </div>
    </div>
  )
}
