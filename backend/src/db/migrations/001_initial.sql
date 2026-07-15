-- Документация миграции 001. Применяется inline в db.service.ts
CREATE TABLE IF NOT EXISTS domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_name VARCHAR(255) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT false,
    is_verified BOOLEAN DEFAULT false,
    mx_verified BOOLEAN DEFAULT false,
    spf_verified BOOLEAN DEFAULT false,
    dkim_verified BOOLEAN DEFAULT false,
    dmarc_verified BOOLEAN DEFAULT false,
    dkim_private_key TEXT,
    dkim_public_key TEXT,
    dkim_selector VARCHAR(63) DEFAULT 'mail',
    max_users INTEGER DEFAULT 0,
    max_mailbox_size_mb INTEGER DEFAULT 1024,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
