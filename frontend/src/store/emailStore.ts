import { create } from 'zustand'
import type { Email } from '@/types'

interface EmailStore {
  searchQuery: string
  composing: boolean
  composeMode: 'new' | 'reply' | 'forward' | 'draft'
  replyToEmail: Email | null
  setSearchQuery: (query: string) => void
  setComposing: (
    composing: boolean,
    mode?: 'new' | 'reply' | 'forward' | 'draft',
    replyTo?: Email | null,
  ) => void
}

export const useEmailStore = create<EmailStore>((set) => ({
  searchQuery: '',
  composing: false,
  composeMode: 'new',
  replyToEmail: null,

  setSearchQuery: (query) => set({ searchQuery: query }),

  setComposing: (composing, mode = 'new', replyTo = null) =>
    set({ composing, composeMode: mode, replyToEmail: replyTo }),
}))
