export interface Contact {
  id: string
  domain_id: string
  owner_id: string | null
  email: string
  display_name: string | null
  phone: string | null
  company: string | null
  position: string | null
  notes: string | null
  is_shared: boolean
  created_at: string
  updated_at: string
}

export interface ContactGroup {
  id: string
  domain_id: string
  owner_id: string | null
  name: string
  is_shared: boolean
  contact_count: number
  created_at: string
}

export interface RecipientSuggestion {
  email: string
  name: string | null
  source: 'contact' | 'user'
}
