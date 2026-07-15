import 'express-serve-static-core'
import type { UserRole } from '../config/constants'

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string
    email?: string
    role?: UserRole
  }
}
