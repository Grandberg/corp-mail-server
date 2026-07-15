import { FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import styles from './LoginPage.module.css'

export function LoginPage() {
  const navigate = useNavigate()
  const { isAuthenticated, isFirstRun, authAllowRegister, setAuth } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (isAuthenticated()) {
    return <Navigate to="/mail/inbox" replace />
  }

  if (isFirstRun) {
    return <Navigate to="/register" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const data = await api.login(email, password)
      setAuth(data.token, data.user)
      navigate('/mail/inbox', { replace: true })
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'response' in err
          ? String((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Ошибка входа')
          : 'Ошибка входа'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logoWrapper}>
          <img src="/app_logo.png" alt="CorpMail" className={styles.logoImg} />
        </div>
        <h1 className={styles.title}>Вход в почту</h1>
        <p className={styles.subtitle}>Корпоративный почтовый сервер</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">Email</label>
            <input
              id="email"
              className={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Пароль</label>
            <input
              id="password"
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>

        {isFirstRun !== null && authAllowRegister !== null && (isFirstRun || authAllowRegister) && (
          <p className={styles.footer}>
            Нет аккаунта? <Link to="/register">Регистрация</Link>
          </p>
        )}
      </div>
    </div>
  )
}
