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
  dkim_public_key: string | null
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
  details: Record<string, unknown> | null
  ip_address: string | null
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
