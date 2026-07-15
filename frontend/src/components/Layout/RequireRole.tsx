import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

interface RequireRoleProps {
  roles: Array<'admin' | 'superadmin'>
}

export function RequireRole({ roles }: RequireRoleProps) {
  const user = useAuthStore((s) => s.user)

  if (!user || !roles.includes(user.role as 'admin' | 'superadmin')) {
    return <Navigate to="/mail/inbox" replace />
  }

  return <Outlet />
}
