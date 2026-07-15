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
  group_by_contacts: boolean
}


