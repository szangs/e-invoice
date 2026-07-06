// Geschützter App-Bereich: AppShell (DP-Standard §4.5) + Sitzungsprüfung
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/shell/AppSidebar'
import { AppTopbar } from '@/components/shell/AppTopbar'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { SessionWatcher } from '@/components/shell/SessionWatcher'
import { authOptions } from '@/lib/auth'
import { APP_VERSION, COPYRIGHT } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/auth/login')
  const u = session.user

  return (
    <div className="app-bg relative flex min-h-screen">
      <AppSidebar role={u.role} />
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
    </div>
  )
}
