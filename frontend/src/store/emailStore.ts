import { create } from 'zustand'
import type { Email, EmailAddress } from '@/types'

interface EmailStore {
  searchQuery: string
  composing: boolean
  composeMode: 'new' | 'reply' | 'forward' | 'draft'
  replyToEmail: Email | null
  initialTo: EmailAddress[] | null
  setSearchQuery: (query: string) => void
  setComposing: (
    composing: boolean,
    mode?: 'new' | 'reply' | 'forward' | 'draft',
    replyTo?: Email | null,
    initialTo?: EmailAddress[] | null,
  ) => void
}

export const useEmailStore = create<EmailStore>((set) => ({
  searchQuery: '',
  composing: false,
  composeMode: 'new',
  replyToEmail: null,
  initialTo: null,

  setSearchQuery: (query) => set({ searchQuery: query }),

  setComposing: (composing, mode = 'new', replyTo = null, initialTo = null) =>
    set({ composing, composeMode: mode, replyToEmail: replyTo, initialTo }),
}))
