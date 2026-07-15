import { Outlet } from 'react-router-dom'
import { AppHeader } from './AppHeader'
import styles from './AppLayout.module.css'

export function AppLayout() {
  return (
    <div className={styles.layout}>
      <AppHeader />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
