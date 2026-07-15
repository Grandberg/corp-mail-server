export interface EmailAddress {
  email: string
  name?: string | null
}

export interface AttachmentMeta {
  id: string
  email_id: string | null
  filename: string
  content_type: string | null
  size_bytes: number
  content_id: string | null
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

export interface EmailDetail extends EmailListItem {
  cc_addresses: EmailAddress[]
  bcc_addresses: EmailAddress[]
  body_html: string | null
  message_id: string | null
  in_reply_to: string | null
  raw_source: string | null
  attachments: AttachmentMeta[]
}

export interface FolderInfo {
  id: string
  name: string
  type: 'system' | 'custom'
  unread_count: number
  total_count: number
  color?: string | null
  parent_id?: string | null
}

export interface SendEmailInput {
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  subject: string
  bodyHtml: string
  attachmentIds?: string[]
  draftId?: string
  inReplyTo?: string | null
  references?: string[]
  scheduledAt?: string | null
  isPlainText?: boolean
}

export interface ScheduleEmailInput {
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  subject: string
  bodyHtml: string
  attachmentIds?: string[]
  draftId?: string
  scheduledAt: string
  isPlainText?: boolean
}

export interface SaveDraftInput {
  to?: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  subject?: string
  bodyHtml?: string
  attachmentIds?: string[]
  draftId?: string
  isPlainText?: boolean
}

export interface UpdateEmailInput {
  is_read?: boolean
  is_starred?: boolean
  folder?: string
}

export interface BulkEmailAction {
  ids: string[]
  action: 'read' | 'unread' | 'star' | 'unstar' | 'trash' | 'delete' | 'move'
  folder?: string
}
