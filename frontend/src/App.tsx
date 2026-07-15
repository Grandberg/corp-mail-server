import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { useMailEvents } from '@/hooks/useMailEvents'
import { AppLayout } from '@/components/Layout/AppLayout'
import { ProtectedRoute } from '@/components/Layout/ProtectedRoute'
import { RequireRole } from '@/components/Layout/RequireRole'
import { LoginPage } from '@/components/Login/LoginPage'
import { RegisterPage } from '@/components/Login/RegisterPage'
import { MailPage } from '@/components/Mail/MailPage'
import { ContactsPage } from '@/components/Contacts/ContactsPage'
import { SettingsPage } from '@/components/Settings/SettingsPage'
import { AdminPage } from '@/components/Admin/AdminPage'
import { NotFoundPage } from '@/components/NotFound/NotFoundPage'

export default function App() {
  const setAuthConfig = useAuthStore((s) => s.setAuthConfig)
  const token = useAuthStore((s) => s.token)
  const setUser = useAuthStore((s) => s.setUser)

  useMailEvents(!!token)

  useEffect(() => {
    void api.getAuthConfig().then((config) => {
      setAuthConfig({
        isFirstRun: config.isFirstRun,
        authEnabled: config.authEnabled,
        authAllowRegister: config.authAllowRegister,
      })
    })
  }, [setAuthConfig])

  useEffect(() => {
    if (!token) return
    void api.getMe().then(({ user }) => setUser(user)).catch(() => undefined)
  }, [token, setUser])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/mail/inbox" replace />} />
          <Route path="/mail" element={<Navigate to="/mail/inbox" replace />} />
          <Route path="/mail/:folder" element={<MailPage />} />
          <Route path="/mail/:folder/:emailId" element={<MailPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route element={<RequireRole roles={['admin', 'superadmin']} />}>
            <Route path="/admin" element={<Navigate to="/admin/domains" replace />} />
            <Route path="/admin/:tab" element={<AdminPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
