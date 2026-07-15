import { Resolver } from 'node:dns/promises'
import { env } from '../config/env'
import type { DnsRecord, DnsRecordStatus } from '../types/domain'
import { formatDkimDnsValue } from './dkim.service'

const resolver = new Resolver()
resolver.setServers(['8.8.8.8', '1.1.1.1'])

function normalizeTxt(records: string[][]): string[] {
  return records.map((parts) => parts.join(''))
}

/** Почтовый хост в DNS конкретного домена (MX, A): mail.example.com */
export function getMailHostname(domainName: string): string {
  const normalized = domainName.trim().toLowerCase().replace(/\.$/, '')
  return `mail.${normalized}`
}

/**
 * Каноническое имя SMTP-сервера (EHLO/PTR) — одно на IP.
 * Задаётся MAIL_HOSTNAME / mail_hostname в секретах (например mail.inoxsigns.com).
 */
export function getServerMailHostname(): string {
  const fromEnv = env.MAIL_HOSTNAME?.trim()
  if (fromEnv) return fromEnv.replace(/\.$/, '')
  return 'mail.example.com'
}

export function generateRequiredRecords(
  domainName: string,
  serverIp: string,
  dkimSelector: string,
  dkimPublicKey: string | null,
): DnsRecord[] {
  const mailHost = getMailHostname(domainName)
  const ptrHost = getServerMailHostname()
  const dkimValue = dkimPublicKey ? formatDkimDnsValue(dkimPublicKey) : 'Сгенерируйте DKIM-ключ в админке'

  return [
    {
      type: 'A',
      name: mailHost,
      value: serverIp,
      description: 'IP почтового сервера для этого домена (тот же IP, что у MTA)',
      status: 'pending',
    },
    {
      type: 'PTR',
      name: serverIp,
      value: ptrHost,
      description:
        'Обратная DNS (rDNS) — одна на IP, настраивается у хостера (OVH). Должна совпадать с MAIL_HOSTNAME сервера (EHLO), общая для всех доменов на этом IP.',
      status: 'pending',
    },
    {
      type: 'MX',
      name: domainName,
      value: `${mailHost} (приоритет 10)`,
      description: 'Указывает, куда доставлять входящую почту',
      status: 'pending',
    },
    {
      type: 'TXT',
      name: domainName,
      value: `v=spf1 mx ip4:${serverIp} -all`,
      description: 'SPF — разрешённые отправители',
      status: 'pending',
    },
    {
      type: 'TXT',
      name: `${dkimSelector}._domainkey.${domainName}`,
      value: dkimValue,
      description: 'DKIM — подпись исходящих писем',
      status: 'pending',
    },
    {
      type: 'TXT',
      name: `_dmarc.${domainName}`,
      value: `v=DMARC1; p=none; rua=mailto:postmaster@${domainName}`,
      description: 'DMARC — на старте p=none; после стабильной доставки можно p=quarantine/reject',
      status: 'pending',
    },
  ]
}

async function safeResolve<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

export async function checkMx(domainName: string, expectedHost: string): Promise<boolean> {
  const mx = await safeResolve(() => resolver.resolveMx(domainName))
  if (!mx?.length) return false
  const expected = expectedHost.toLowerCase().replace(/\.$/, '')
  return mx.some((r) => r.exchange.toLowerCase().replace(/\.$/, '').includes(expected))
}

export async function checkSpf(domainName: string, serverIp: string): Promise<boolean> {
  const txt = await safeResolve(() => resolver.resolveTxt(domainName))
  if (!txt) return false
  const records = normalizeTxt(txt)
  return records.some(
    (r) => r.startsWith('v=spf1') && (r.includes(`ip4:${serverIp}`) || r.includes('mx')),
  )
}

export async function checkDkim(
  domainName: string,
  selector: string,
  expectedValue?: string | null,
): Promise<boolean> {
  const host = `${selector}._domainkey.${domainName}`
  const txt = await safeResolve(() => resolver.resolveTxt(host))
  if (!txt) return false
  const records = normalizeTxt(txt)
  if (!records.some((r) => r.includes('v=DKIM1'))) return false
  if (!expectedValue) return true
  const expectedP = expectedValue.match(/p=([A-Za-z0-9+/=]+)/)?.[1]
  if (!expectedP) return true
  return records.some((r) => r.replace(/\s+/g, '').includes(expectedP.slice(0, 32)))
}

export async function checkDmarc(domainName: string): Promise<boolean> {
  const host = `_dmarc.${domainName}`
  const txt = await safeResolve(() => resolver.resolveTxt(host))
  if (!txt) return false
  return normalizeTxt(txt).some((r) => r.startsWith('v=DMARC1'))
}

export async function checkARecord(hostname: string, serverIp: string): Promise<boolean> {
  const ips = await safeResolve(() => resolver.resolve4(hostname))
  return ips?.includes(serverIp) ?? false
}

function ptrArpaName(serverIp: string): string {
  return `${serverIp.split('.').reverse().join('.')}.in-addr.arpa`
}

export async function resolvePtr(serverIp: string): Promise<string[]> {
  const ptr = await safeResolve(() => resolver.resolvePtr(ptrArpaName(serverIp)))
  return ptr?.map((h) => h.toLowerCase().replace(/\.$/, '')) ?? []
}

/** FCrDNS: PTR IP должен указывать на hostname, а hostname — на тот же IP. */
export async function checkPtr(serverIp: string, expectedHost: string): Promise<boolean> {
  const ptr = await resolvePtr(serverIp)
  if (!ptr.length) return false
  const expected = expectedHost.toLowerCase().replace(/\.$/, '')
  return ptr.some((h) => h === expected)
}

export function applyVerificationStatuses(
  records: DnsRecord[],
  flags: { a: boolean; mx: boolean; spf: boolean; dkim: boolean; dmarc: boolean; ptr: boolean },
  dnsChecked: boolean,
  ptrActual?: string[],
): DnsRecord[] {
  const toStatus = (ok: boolean): DnsRecordStatus => {
    if (!dnsChecked) return 'pending'
    return ok ? 'verified' : 'failed'
  }

  return records.map((rec) => {
    if (rec.type === 'PTR') {
      const status = toStatus(flags.ptr)
      const actual = ptrActual?.length ? ptrActual.join(', ') : 'не задана'
      return {
        ...rec,
        status,
        value: flags.ptr ? rec.value : `${rec.value} (сейчас: ${actual})`,
      }
    }
    if (rec.type === 'A') return { ...rec, status: toStatus(flags.a) }
    if (rec.type === 'MX') return { ...rec, status: toStatus(flags.mx) }
    if (rec.name.includes('_domainkey')) return { ...rec, status: toStatus(flags.dkim) }
    if (rec.name.startsWith('_dmarc')) return { ...rec, status: toStatus(flags.dmarc) }
    if (rec.value.startsWith('v=spf1')) return { ...rec, status: toStatus(flags.spf) }
    return rec
  })
}

export async function verifyDnsRecords(
  domainName: string,
  dkimSelector: string,
  dkimPublicKey: string | null,
): Promise<{
  mx: boolean
  spf: boolean
  dkim: boolean
  dmarc: boolean
  a: boolean
  ptr: boolean
  records: DnsRecord[]
}> {
  const serverIp = env.SERVER_PUBLIC_IP
  const mailHost = getMailHostname(domainName)
  const ptrHost = getServerMailHostname()

  const [mx, spf, dkim, dmarc, a, ptrActual] = await Promise.all([
    checkMx(domainName, mailHost),
    checkSpf(domainName, serverIp),
    checkDkim(domainName, dkimSelector, dkimPublicKey ? formatDkimDnsValue(dkimPublicKey) : null),
    checkDmarc(domainName),
    checkARecord(mailHost, serverIp),
    resolvePtr(serverIp),
  ])
  const ptrExpected = ptrHost.toLowerCase().replace(/\.$/, '')
  const ptr = ptrActual.some((h) => h === ptrExpected)

  const base = generateRequiredRecords(domainName, serverIp, dkimSelector, dkimPublicKey)
  const flags = { a, mx, spf, dkim, dmarc, ptr }
  const records = applyVerificationStatuses(base, flags, true, ptrActual)

  return { ...flags, records }
}
