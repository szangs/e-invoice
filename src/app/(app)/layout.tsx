// Geschützter App-Bereich: AppShell (DP-Standard §4.5) + Sitzungsprüfung
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AiBackupNotice } from '@/components/shell/AiBackupNotice'
import { AppSidebar } from '@/components/shell/AppSidebar'
import { AppTopbar } from '@/components/shell/AppTopbar'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { FeedbackButton } from '@/components/shell/FeedbackButton'
import { HandoffInbox } from '@/components/shell/HandoffInbox'
import { SessionWatcher } from '@/components/shell/SessionWatcher'
import { authOptions } from '@/lib/auth'
import { APP_VERSION, COPYRIGHT } from '@/lib/config'
import { prisma } from '@/lib/db'
import { hasRoleAction } from '@/lib/roleActions'
import { getSetting } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/auth/login')
  const u = session.user
  const feedbackEnabled = (await getSetting('FEEDBACK_ENABLED')) === '1'
  // Audit-Protokoll-Menüpunkt konsistent mit der Rollen-Rechte-Matrix
  // (Stefan 2026-08-27, siehe lib/roleActions.ts) — vorher hing die
  // Sichtbarkeit an der festen Rolle "Prüfer", während die Seite selbst
  // inzwischen die editierbare Matrix prüft; ohne diesen Abgleich hätte ein
  // per Matrix freigeschalteter Bearbeiter/Bereichsleitung/Nutzer den
  // Menüpunkt nie gesehen, obwohl der Aufruf der Seite geklappt hätte.
  const canViewAudit = u.tenantId
    ? hasRoleAction(await prisma.tenant.findUnique({ where: { id: u.tenantId }, select: { roleActions: true } }), u.role, 'VIEW_AUDIT')
    : false

  return (
    <div className="app-bg relative flex min-h-screen">
      <AppSidebar role={u.role} canViewAudit={canViewAudit} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar
          tenantName={u.tenantName}
          role={u.role}
          email={u.email}
          impersonatorName={u.impersonatorName}
        />
        <SessionWatcher impersonating={Boolean(u.impersonatorId)} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
        <footer className="px-6 py-3 text-[10px] font-mono text-gray-400 print:hidden">
          {COPYRIGHT} · v{APP_VERSION}
        </footer>
      </div>
      <CommandPalette />
      <FeedbackButton enabled={feedbackEnabled} />
      <AiBackupNotice />
      {u.tenantId && <HandoffInbox />}
    </div>
  )
}
