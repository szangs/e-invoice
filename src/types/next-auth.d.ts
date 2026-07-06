import { Role } from '@prisma/client'
import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name: string
      email: string
      role: Role
      tenantId: string | null
      tenantSlug: string | null
      tenantName: string | null
      impersonatorId: string | null
      impersonatorName: string | null
      loginAt: number
    }
  }
  interface User {
    id: string
    role: Role
    tenantId: string | null
    tenantSlug: string | null
    tenantName: string | null
    impersonatorId: string | null
    impersonatorName: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid: string
    role: Role
    tenantId: string | null
    tenantSlug: string | null
    tenantName: string | null
    impersonatorId: string | null
    impersonatorName: string | null
    loginAt: number
  }
}
