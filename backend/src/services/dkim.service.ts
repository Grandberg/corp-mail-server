import { generateKeyPairSync } from 'node:crypto'
import { getPool } from './db.service'

export interface DkimKeyPair {
  privateKey: string
  publicKey: string
  dnsValue: string
}

/** PEM → значение для TXT-записи DKIM (p=...) */
export function formatDkimDnsValue(publicKeyPem: string): string {
  const body = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')
  return `v=DKIM1; k=rsa; p=${body}`
}

export function generateDkimKeyPair(): DkimKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  return {
    privateKey,
    publicKey,
    dnsValue: formatDkimDnsValue(publicKey),
  }
}

export async function generateAndStoreDkimKeys(
  domainId: string,
  selector = 'mail',
): Promise<{ selector: string; publicKey: string; dnsValue: string }> {
  const keys = generateDkimKeyPair()
  await getPool().query(
    `UPDATE domains SET
       dkim_private_key = $2,
       dkim_public_key = $3,
       dkim_selector = $4,
       updated_at = NOW()
     WHERE id = $1`,
    [domainId, keys.privateKey, keys.publicKey, selector],
  )
  return { selector, publicKey: keys.publicKey, dnsValue: keys.dnsValue }
}
