import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

const TOKEN_KEY = 'email_token'

interface AuthStore {
  token: string | null
  user: User | null
  isFirstRun: boolean | null
  authEnabled: boolean | null
  authAllowRegister: boolean | null
  setAuth: (token: string, user: User) => void
  setUser: (user: User) => void
  setAuthConfig: (config: { isFirstRun: boolean; authEnabled: boolean; authAllowRegister: boolean }) => void
  logout: () => void
  isAuthenticated: () => boolean
}

export function isTokenValid(token: string): boolean {
  if (token === 'auth-disabled') return false
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number }
    if (payload.exp && payload.exp * 1000 < Date.now()) return false
    return true
  } catch {
    return false
  }
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isFirstRun: null,
      authEnabled: null,
      authAllowRegister: null,

      setAuth: (token, user) => set({ token, user }),

      setUser: (user) => set({ user }),

      setAuthConfig: ({ isFirstRun, authEnabled, authAllowRegister }) =>
        set({ isFirstRun, authEnabled, authAllowRegister }),

      logout: () => set({ token: null, user: null }),

      isAuthenticated: () => {
        const { token, authEnabled } = get()
        if (authEnabled === false) return true
        if (!token || !isTokenValid(token)) return false
        return true
      },
    }),
    {
      name: TOKEN_KEY,
      partialize: (state) => ({
        token: state.token,
        user: state.user,
      }),
    },
  ),
)
