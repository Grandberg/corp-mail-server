import { Link } from 'react-router-dom'
import styles from '../Mail/MailPage.module.css'

export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>404</h1>
      <p className={styles.text}>Страница не найдена. <Link to="/">На главную</Link></p>
    </div>
  )
}
