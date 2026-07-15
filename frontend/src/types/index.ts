export type UserRole = 'superadmin' | 'admin' | 'user'

export interface User {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  domain_id: string | null
  role: UserRole
  is_active: boolean
}

export interface AdminUser extends User {
  unread_count: number
  total_emails: number
  mailbox_size_bytes: number
}

export interface AuthConfig {
  authEnabled: boolean
  isFirstRun: boolean
  authAllowRegister: boolean
}

export interface AuthResponse {
  token: string
  expiresIn?: string
  user: User
}

export interface EmailAddress {
  email: string
  name?: string | null
}

export interface Attachment {
  id: string
  email_id: string | null
  filename: string
  content_type: string | null
  size_bytes: number
  content_id?: string | null
  created_at: string
}

export interface EmailListItem {
  id: string
  folder: string
  from_address: string
  from_name: string | null
  to_addresses: EmailAddress[]
  subject: string | null
  body_text: string | null
  is_read: boolean
  is_starred: boolean
  has_attachments: boolean
  received_at: string | null
  sent_at: string | null
  scheduled_at: string | null
  created_at: string
  is_plain_text?: boolean
}

export interface Email extends EmailListItem {
  cc_addresses: EmailAddress[]
  bcc_addresses: EmailAddress[]
  body_html: string | null
  message_id: string | null
  in_reply_to: string | null
  raw_source: string | null
  attachments: Attachment[]
}

export interface Folder {
  id: string
  name: string
  type: 'system' | 'custom'
  unread_count: number
  total_count: number
  color?: string | null
  parent_id?: string | null
}

export interface EmailsPage {
  emails: EmailListItem[]
  total: number
  page: number
  hasMore: boolean
}

export type ComposeMode = 'new' | 'reply' | 'forward' | 'draft'

export type DnsRecordStatus = 'pending' | 'verified' | 'failed'

export interface DnsRecord {
  type: 'A' | 'MX' | 'TXT' | 'CNAME' | 'PTR'
  name: string
  value: string
  description: string
  status: DnsRecordStatus
}

export interface Domain {
  id: string
  domain_name: string
  is_active: boolean
  is_verified: boolean
  mx_verified: boolean
  spf_verified: boolean
  dkim_verified: boolean
  dmarc_verified: boolean
  a_verified: boolean
  dns_checked_at: string | null
  dkim_selector: string
  max_users: number
  max_mailbox_size_mb: number
  created_at: string
  updated_at: string
}

export interface DomainVerificationResult {
  domain: Domain
  records: DnsRecord[]
  all_verified: boolean
}

export interface Alias {
  id: string
  domain_id: string
  source_address: string
  destination_user_id: string
  destination_email?: string
  is_active: boolean
  created_at: string
}

export interface AuditEntry {
  id: string
  user_id: string | null
  user_email?: string | null
  action: string
  target_type: string | null
  target_id: string | null
  created_at: string
}

export interface AdminStats {
  total_users: number
  total_domains: number
  total_emails: number
  active_domains: number
  verified_domains: number
  storage_used_bytes: number
}

export interface DbConfigInfo {
  mode: 'external' | 'local'
  host: string
  port: number
  database: string
  user: string
  connected: boolean
}

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

export type RuleConditionField = 'from' | 'to' | 'subject'
export type RuleConditionOperator = 'contains' | 'equals'

export interface RuleCondition {
  field: RuleConditionField
  operator: RuleConditionOperator
  value: string
}

export type RuleActionType = 'move' | 'mark_read' | 'delete' | 'star'

export interface RuleAction {
  type: RuleActionType
  params?: { folder?: string }
}

export interface EmailRule {
  id: string
  user_id: string
  name: string
  conditions: RuleCondition[]
  actions: RuleAction[]
  is_active: boolean
  priority: number
  created_at: string
}

export interface UserSettings {
  email: string
  display_name: string | null
  avatar_url: string | null
  signature_html: string | null
  auto_reply_enabled: boolean
  auto_reply_subject: string | null
  auto_reply_body: string | null
  telegram_username: string | null
  telegram_phone: string | null
  telegram_chat_id: string | null
  telegram_notifications_enabled: boolean
  telegram_bot_username?: string | null
  group_by_contacts?: boolean
}
