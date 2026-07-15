import { FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import loginStyles from './LoginPage.module.css'
import styles from './RegisterPage.module.css'

export function RegisterPage() {
  const navigate = useNavigate()
  const { isAuthenticated, isFirstRun, authAllowRegister, setAuth } = useAuthStore()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (isAuthenticated()) {
    return <Navigate to="/mail/inbox" replace />
  }

  if (isFirstRun === false && authAllowRegister === false) {
    return <Navigate to="/login" replace />
  }

  if (isFirstRun === null || authAllowRegister === null) {
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const data = await api.register(email, password, displayName || undefined)
      setAuth(data.token, data.user)
      navigate('/mail/inbox', { replace: true })
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'response' in err
          ? String((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Ошибка регистрации')
          : 'Ошибка регистрации'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={loginStyles.container}>
      <div className={loginStyles.card}>
        <div className={loginStyles.logoWrapper}>
          <img src="/app_logo.png" alt="CorpMail" className={loginStyles.logoImg} />
        </div>
        <h1 className={`${loginStyles.title} ${isFirstRun ? styles.registerTitle : ''}`}>
          {isFirstRun ? 'Создание суперадмина' : 'Регистрация'}
        </h1>
        <p className={loginStyles.subtitle}>
          {isFirstRun
            ? 'Первый пользователь станет суперадмином и создаст домен из email'
            : 'Создание нового аккаунта'}
        </p>

        {isFirstRun && (
          <p className={styles.hint}>
            Укажите корпоративный email, например admin@yourcompany.com — домен yourcompany.com будет создан автоматически.
          </p>
        )}

        <form className={loginStyles.form} onSubmit={handleSubmit}>
          <div className={loginStyles.field}>
            <label className={loginStyles.label} htmlFor="email">Email</label>
            <input
              id="email"
              className={loginStyles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className={loginStyles.field}>
            <label className={loginStyles.label} htmlFor="displayName">Имя (необязательно)</label>
            <input
              id="displayName"
              className={loginStyles.input}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className={loginStyles.field}>
            <label className={loginStyles.label} htmlFor="password">Пароль</label>
            <input
              id="password"
              className={loginStyles.input}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>

          {error && <div className={loginStyles.error}>{error}</div>}

          <button className={loginStyles.button} type="submit" disabled={loading}>
            {loading ? 'Создание…' : isFirstRun ? 'Создать суперадмина' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className={loginStyles.footer}>
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </div>
    </div>
  )
}
