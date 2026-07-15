import Redis from 'ioredis'
import { env } from '../config/env'

let redis: Redis | null = null

export function getRedis(): Redis | null {
  if (!env.REDIS_PASSWORD) return null
  if (!redis) {
    redis = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    })
  }
  return redis
}

export async function checkRedisConnection(): Promise<boolean> {
  const client = getRedis()
  if (!client) return false
  try {
    if (client.status !== 'ready') {
      await client.connect()
    }
    const pong = await client.ping()
    return pong === 'PONG'
  } catch {
    return false
  }
}
