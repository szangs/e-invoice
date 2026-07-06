// Authentifizierung & Sitzung (§5) — next-auth 4, Credentials + JWT
// Zweistufig: /api/auth/precheck (öffentlich) prüft vor, hier entsteht die Sitzung.
import { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { audit } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { getSetting } from '@/lib/settings'

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: '/auth/login' },
  providers: [
    CredentialsProvider({
      name: 'Anmeldung',
      credentials: {
        email: { type: 'text' },
        password: { type: 'password' },
        tenantId: { type: 'text' }, // "operator" für Betreiber-Ebene
        ticket: { type: 'text' }, // Einmal-Ticket für Identitätsübernahme (§12)
      },
      async authorize(credentials) {
        // ── Weg A: Einmal-Ticket (Identitätsübernahme / Rückkehr) ──
        if (credentials?.ticket) {
          const ticket = await prisma.loginTicket.findUnique({ where: { code: credentials.ticket } })
          if (!ticket || ticket.usedAt || ticket.expiresAt < new Date()) return null
          await prisma.loginTicket.update({ where: { id: ticket.id }, data: { usedAt: new Date() } })
          const user = await prisma.user.findUnique({
            where: { id: ticket.targetUserId },
            include: { tenant: true },
          })
          if (!user || !user.active) return null
          if (ticket.impersonatorId) {
            await audit({
              tenantId: user.tenantId,
              actorId: ticket.impersonatorId,
              actorName: ticket.impersonatorName ?? 'Betreiber',
              action: 'IMPERSONATE_START',
              details: `Identitätsübernahme als ${user.email} (${user.tenant?.name ?? '—'})`,
            })
          }
          return {
            id: user.id,
            name: user.username,
            email: user.email,
            role: user.role,
            tenantId: user.tenantId,
            tenantSlug: user.tenant?.slug ?? null,
            tenantName: user.tenant?.name ?? null,
            impersonatorId: ticket.impersonatorId,
            impersonatorName: ticket.impersonatorName,
          }
        }

        // ── Weg B: E-Mail + Passwort + Mandant ──
        if (!credentials?.email || !credentials.password || !credentials.tenantId) return null
        const email = credentials.email.trim().toLowerCase()
        const isOperator = credentials.tenantId === 'operator'

        const user = await prisma.user.findFirst({
          where: { email, tenantId: isOperator ? null : credentials.tenantId },
          include: { tenant: true },
        })
        if (!user || !user.active) return null
        const ok = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!ok) {
          await audit({
            tenantId: user.tenantId,
            actorName: email,
            action: 'LOGIN_FAILED',
            details: 'Falsches Passwort',
          })
          return null
        }
        // Mandant gesperrt / Wartungssperre — serverseitig erzwungen (§5/§9)
        if (user.tenantId) {
          if (!user.tenant?.active) return null
          if ((await getSetting('MAINTENANCE_LOCK')) === '1') return null
        }
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
        })
        await audit({
          tenantId: user.tenantId,
          actorId: user.id,
          actorName: user.email,
          action: 'LOGIN',
          details: user.tenant ? `Mandant: ${user.tenant.name}` : 'Betreiber-Ebene',
        })
        return {
          id: user.id,
          name: user.username,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
          tenantSlug: user.tenant?.slug ?? null,
          tenantName: user.tenant?.name ?? null,
          impersonatorId: null,
          impersonatorName: null,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id
        token.role = user.role
        token.tenantId = user.tenantId
        token.tenantSlug = user.tenantSlug
        token.tenantName = user.tenantName
        token.impersonatorId = user.impersonatorId
        token.impersonatorName = user.impersonatorName
        token.loginAt = Date.now()
      }
      return token
    },
    async session({ session, token }) {
      session.user = {
        id: token.uid,
        name: (token.name as string) ?? '',
        email: (token.email as string) ?? '',
        role: token.role,
        tenantId: token.tenantId,
        tenantSlug: token.tenantSlug,
        tenantName: token.tenantName,
        impersonatorId: token.impersonatorId,
        impersonatorName: token.impersonatorName,
        loginAt: token.loginAt,
      }
      return session
    },
  },
  events: {
    async signOut({ token }) {
      if (token?.uid) {
        await audit({
          tenantId: token.tenantId ?? null,
          actorId: token.uid,
          actorName: (token.email as string) ?? token.uid,
          action: 'LOGOUT',
        })
      }
    },
  },
}

export const OPERATOR: Role = Role.OPERATOR_ADMIN
