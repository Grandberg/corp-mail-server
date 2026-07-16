import axios from 'axios'
import type {
  AdminUser,
  Attachment,
  AuthConfig,
  AuthResponse,
  Email,
  EmailAddress,
  EmailsPage,
  Folder,
  User,
  UserRole,
  UserSettings,
} from '@/types'
import { useAuthStore } from '@/store/authStore'
import { API_URL } from '@/config/constants'

declare module 'axios' {
  interface AxiosRequestConfig {
    _authRetry?: boolean
  }
}

export const http = axios.create({
  baseURL: API_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

function isAuthExemptPath(url: string | undefined): boolean {
  if (!url) return false
  return (
    url.includes('/auth/login') ||
    url.includes('/auth/register') ||
    url.includes('/auth/refresh') ||
    url.includes('/auth/config')
  )
}

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error)
    }

    const status = error.response?.status
    const original = error.config
    if (status !== 401 || !original || original._authRetry || isAuthExemptPath(original.url)) {
      if (status === 401 && !isAuthExemptPath(original?.url)) {
        useAuthStore.getState().logout()
      }
      return Promise.reject(error)
    }

    const refreshed = await refreshAuthSession()
    if (!refreshed) {
      useAuthStore.getState().logout()
      return Promise.reject(error)
    }

    original._authRetry = true
    const nextToken = useAuthStore.getState().token
    if (nextToken) {
      original.headers.Authorization = `Bearer ${nextToken}`
    }
    return http(original)
  },
)

export async function refreshAuthSession(): Promise<boolean> {
  const token = useAuthStore.getState().token
  if (!token) return false

  try {
    const { data } = await http.post<AuthResponse>('/auth/refresh', null, {
      headers: { Authorization: `Bearer ${token}` },
      _authRetry: true,
    })
    useAuthStore.getState().setAuth(data.token, data.user)
    return true
  } catch {
    return false
  }
}

export const api = {
  async getAuthConfig(): Promise<AuthConfig> {
    const { data } = await http.get<AuthConfig>('/auth/config')
    return data
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const { data } = await http.post<AuthResponse>('/auth/login', { email, password })
    return data
  },

  async register(email: string, password: string, displayName?: string): Promise<AuthResponse> {
    const { data } = await http.post<AuthResponse>('/auth/register', {
      email,
      password,
      displayName,
    })
    return data
  },

  async getMe(): Promise<{ user: User }> {
    const { data } = await http.get<{ user: User }>('/auth/me')
    return data
  },

  async health(): Promise<{ status: string; db: string; redis: string }> {
    const { data } = await http.get<{ status: string; db: string; redis: string }>('/health')
    return data
  },

  async getFolders(): Promise<Folder[]> {
    const { data } = await http.get<Folder[]>('/folders')
    return data
  },

  async getEmails(params: {
    folder: string
    page?: number
    search?: string
    sort?: string
  }): Promise<EmailsPage> {
    const { data } = await http.get<EmailsPage>('/emails', { params })
    return data
  },

  async getEmail(id: string): Promise<Email> {
    const { data } = await http.get<Email>(`/emails/${id}`)
    return data
  },

  async getEmailThread(id: string): Promise<Email[]> {
    const { data } = await http.get<{ messages: Email[] }>(`/emails/${id}/thread`)
    return data.messages
  },

  async sendEmail(payload: {
    to: EmailAddress[]
    cc?: EmailAddress[]
    bcc?: EmailAddress[]
    subject: string
    bodyHtml: string
    attachmentIds?: string[]
    draftId?: string
    isPlainText?: boolean
  }): Promise<Email> {
    const { data } = await http.post<Email>('/emails/send', payload)
    return data
  },

  async saveDraft(payload: {
    to?: EmailAddress[]
    cc?: EmailAddress[]
    bcc?: EmailAddress[]
    subject?: string
    bodyHtml?: string
    attachmentIds?: string[]
    draftId?: string
    isPlainText?: boolean
  }): Promise<Email> {
    const { data } = await http.post<Email>('/emails/draft', payload)
    return data
  },

  async scheduleEmail(payload: {
    to: EmailAddress[]
    cc?: EmailAddress[]
    bcc?: EmailAddress[]
    subject: string
    bodyHtml: string
    attachmentIds?: string[]
    draftId?: string
    scheduledAt: string
    isPlainText?: boolean
  }): Promise<Email> {
    const { data } = await http.post<Email>('/emails/schedule', payload)
    return data
  },

  async unscheduleEmail(id: string): Promise<Email> {
    const { data } = await http.delete<Email>(`/emails/${id}/unschedule`)
    return data
  },

  async updateEmail(
    id: string,
    patch: { is_read?: boolean; is_starred?: boolean; folder?: string },
  ): Promise<Email> {
    const { data } = await http.put<Email>(`/emails/${id}`, patch)
    return data
  },

  async deleteEmail(id: string, permanent = false): Promise<void> {
    await http.delete(`/emails/${id}`, { params: permanent ? { permanent: 'true' } : undefined })
  },

  async replyEmail(id: string, bodyHtml: string, attachmentIds?: string[], isPlainText?: boolean): Promise<Email> {
    const { data } = await http.post<Email>(`/emails/${id}/reply`, { bodyHtml, attachmentIds, isPlainText })
    return data
  },

  async forwardEmail(id: string, to: EmailAddress[], bodyHtml: string, isPlainText?: boolean): Promise<Email> {
    const { data } = await http.post<Email>(`/emails/${id}/forward`, { to, bodyHtml, isPlainText })
    return data
  },

  async bulkEmailAction(payload: {
    ids: string[]
    action: 'read' | 'unread' | 'star' | 'unstar' | 'trash' | 'delete' | 'move'
    folder?: string
  }): Promise<{ updated: number }> {
    const { data } = await http.patch<{ updated: number }>('/emails/bulk', payload)
    return data
  },

  async uploadAttachment(file: File): Promise<Attachment> {
    const form = new FormData()
    form.append('file', file)
    const { data } = await http.post<Attachment>('/attachments/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120_000,
    })
    return data
  },

  getAttachmentUrl(id: string): string {
    return `${API_URL}/attachments/${id}`
  },

  async getAdminDomains(): Promise<import('@/types').Domain[]> {
    const { data } = await http.get<import('@/types').Domain[]>('/admin/domains')
    return data
  },

  async createDomain(domainName: string): Promise<import('@/types').Domain> {
    const { data } = await http.post<import('@/types').Domain>('/admin/domains', { domainName })
    return data
  },

  async getDomainDnsRecords(domainId: string): Promise<import('@/types').DnsRecord[]> {
    const { data } = await http.get<import('@/types').DnsRecord[]>(`/admin/domains/${domainId}/dns-records`)
    return data
  },

  async verifyDomain(domainId: string): Promise<import('@/types').DomainVerificationResult> {
    const { data } = await http.post<import('@/types').DomainVerificationResult>(
      `/admin/domains/${domainId}/verify`,
    )
    return data
  },

  async generateDomainDkim(domainId: string): Promise<{ selector: string; publicKey: string; dnsValue: string }> {
    const { data } = await http.post<{ selector: string; publicKey: string; dnsValue: string }>(
      `/admin/domains/${domainId}/generate-dkim`,
    )
    return data
  },

  async getAdminUsers(domainId?: string): Promise<AdminUser[]> {
    const { data } = await http.get<AdminUser[]>('/admin/users', { params: domainId ? { domainId } : undefined })
    return data
  },

  async createAdminUser(payload: {
    email: string
    password: string
    displayName?: string
    role?: UserRole
    domainId: string
  }): Promise<AdminUser> {
    const { data } = await http.post<AdminUser>('/admin/users', payload)
    return data
  },

  async deleteAdminUser(id: string): Promise<void> {
    await http.delete(`/admin/users/${id}`)
  },

  async updateAdminUser(
    id: string,
    payload: {
      displayName?: string | null
      role?: UserRole
      isActive?: boolean
      password?: string
    },
  ): Promise<User> {
    const { data } = await http.put<User>(`/admin/users/${id}`, payload)
    return data
  },

  async getAdminAliases(domainId?: string): Promise<import('@/types').Alias[]> {
    const { data } = await http.get<import('@/types').Alias[]>('/admin/aliases', {
      params: domainId ? { domainId } : undefined,
    })
    return data
  },

  async createAlias(payload: {
    sourceAddress: string
    destinationUserId: string
    domainId: string
  }): Promise<import('@/types').Alias> {
    const { data } = await http.post<import('@/types').Alias>('/admin/aliases', payload)
    return data
  },

  async deleteAlias(id: string): Promise<void> {
    await http.delete(`/admin/aliases/${id}`)
  },

  async getAdminStats(): Promise<import('@/types').AdminStats> {
    const { data } = await http.get<import('@/types').AdminStats>('/admin/system/stats')
    return data
  },

  async getAuditLog(page = 1): Promise<{ items: import('@/types').AuditEntry[]; total: number; page: number }> {
    const { data } = await http.get<{ items: import('@/types').AuditEntry[]; total: number; page: number }>(
      '/admin/system/audit-log',
      { params: { page } },
    )
    return data
  },

  async getMailQueue(): Promise<{
    items: unknown[]
    message?: string
    mta_enabled?: boolean
    mta_connected?: boolean
  }> {
    const { data } = await http.get<{
      items: unknown[]
      message?: string
      mta_enabled?: boolean
      mta_connected?: boolean
    }>('/admin/system/queue')
    return data
  },

  async getServerMailConfig(): Promise<{
    server_public_ip: string
    mail_hostname: string | null
    mta_enabled: boolean
    ip_source: string
  }> {
    const { data } = await http.get<{
      server_public_ip: string
      mail_hostname: string | null
      mta_enabled: boolean
      ip_source: string
    }>('/admin/system/mail-config')
    return data
  },

  async getDbConfig(): Promise<import('@/types').DbConfigInfo> {
    const { data } = await http.get<import('@/types').DbConfigInfo>('/admin/system/db-config')
    return data
  },

  async testDbConnection(connectionString: string): Promise<boolean> {
    const { data } = await http.post<{ success: boolean }>('/admin/system/db-config/test', {
      connectionString,
    })
    return data.success
  },

  async applyDbConfig(connectionString: string): Promise<{ applied: boolean; path: string; message: string }> {
    const { data } = await http.put<{ applied: boolean; path: string; message: string }>(
      '/admin/system/db-config',
      { connectionString },
    )
    return data
  },

  async getContacts(): Promise<import('@/types').Contact[]> {
    const { data } = await http.get<import('@/types').Contact[]>('/contacts')
    return data
  },

  async searchRecipients(query: string): Promise<import('@/types').RecipientSuggestion[]> {
    const { data } = await http.get<import('@/types').RecipientSuggestion[]>('/contacts/search', {
      params: { q: query },
    })
    return data
  },

  async createContact(payload: {
    email: string
    displayName?: string
    phone?: string
    company?: string
    position?: string
    notes?: string
    isShared?: boolean
  }): Promise<import('@/types').Contact> {
    const { data } = await http.post<import('@/types').Contact>('/contacts', payload)
    return data
  },

  async updateContact(
    id: string,
    payload: Partial<{
      email: string
      displayName: string
      phone: string
      company: string
      position: string
      notes: string
      isShared: boolean
    }>,
  ): Promise<import('@/types').Contact> {
    const { data } = await http.put<import('@/types').Contact>(`/contacts/${id}`, payload)
    return data
  },

  async deleteContact(id: string): Promise<void> {
    await http.delete(`/contacts/${id}`)
  },

  async getContactGroups(): Promise<import('@/types').ContactGroup[]> {
    const { data } = await http.get<import('@/types').ContactGroup[]>('/contacts/groups')
    return data
  },

  async createContactGroup(name: string, isShared?: boolean): Promise<import('@/types').ContactGroup> {
    const { data } = await http.post<import('@/types').ContactGroup>('/contacts/groups', { name, isShared })
    return data
  },

  async deleteContactGroup(id: string): Promise<void> {
    await http.delete(`/contacts/groups/${id}`)
  },

  async getRules(): Promise<import('@/types').EmailRule[]> {
    const { data } = await http.get<import('@/types').EmailRule[]>('/rules')
    return data
  },

  async createRule(payload: {
    name: string
    conditions: import('@/types').RuleCondition[]
    actions: import('@/types').RuleAction[]
    isActive?: boolean
    priority?: number
  }): Promise<import('@/types').EmailRule> {
    const { data } = await http.post<import('@/types').EmailRule>('/rules', payload)
    return data
  },

  async updateRule(
    id: string,
    payload: {
      name: string
      conditions: import('@/types').RuleCondition[]
      actions: import('@/types').RuleAction[]
      isActive?: boolean
      priority?: number
    },
  ): Promise<import('@/types').EmailRule> {
    const { data } = await http.put<import('@/types').EmailRule>(`/rules/${id}`, payload)
    return data
  },

  async deleteRule(id: string): Promise<void> {
    await http.delete(`/rules/${id}`)
  },

  async getSettings(): Promise<UserSettings> {
    const { data } = await http.get<UserSettings>('/settings')
    return data
  },

  async updateProfile(displayName: string): Promise<import('@/types').UserSettings> {
    const { data } = await http.put<import('@/types').UserSettings>('/settings/profile', { displayName })
    return data
  },

  async updateGroupByContacts(groupByContacts: boolean): Promise<import('@/types').UserSettings> {
    const { data } = await http.put<import('@/types').UserSettings>('/settings/group-by-contacts', { groupByContacts })
    return data
  },

  async updateAvatar(file: File): Promise<import('@/types').UserSettings> {
    const form = new FormData()
    form.append('file', file)
    const { data } = await http.put<import('@/types').UserSettings>('/settings/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  async updateSignature(signatureHtml: string): Promise<import('@/types').UserSettings> {
    const { data } = await http.put<import('@/types').UserSettings>('/settings/signature', { signatureHtml })
    return data
  },

  async updateAutoReply(payload: {
    enabled: boolean
    subject?: string
    body?: string
  }): Promise<import('@/types').UserSettings> {
    const { data } = await http.put<import('@/types').UserSettings>('/settings/auto-reply', payload)
    return data
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await http.put('/settings/password', { currentPassword, newPassword })
  },

  async updateTelegramSettings(payload: {
    username: string | null
    phone: string | null
    enabled: boolean
  }): Promise<UserSettings> {
    const { data } = await http.put<UserSettings>('/settings/telegram', payload)
    return data
  },

  async testTelegramNotification(): Promise<{ success: boolean }> {
    const { data } = await http.post<{ success: boolean }>('/settings/telegram/test')
    return data
  },

  async getTelegramConfig(): Promise<{ token: string; username: string }> {
    const { data } = await http.get<{ token: string; username: string }>('/admin/system/telegram-config')
    return data
  },

  async applyTelegramConfig(token: string, username: string): Promise<{ success: boolean }> {
    const { data } = await http.put<{ success: boolean }>('/admin/system/telegram-config', { token, username })
    return data
  },

  async getTelegramBotStatus(): Promise<{
    isPolling: boolean
    botUsername: string | null
    lastPollError: string | null
    lastPollSuccessAt: string | null
  }> {
    const { data } = await http.get<{
      isPolling: boolean
      botUsername: string | null
      lastPollError: string | null
      lastPollSuccessAt: string | null
    }>('/admin/system/telegram-status')
    return data
  },

  async createFolder(name: string, color?: string): Promise<Folder> {
    const { data } = await http.post<Folder>('/folders', { name, color })
    return data
  },

  async deleteFolder(id: string): Promise<void> {
    await http.delete(`/folders/${id}`)
  },
}
