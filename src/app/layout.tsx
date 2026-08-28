import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { Inter, JetBrains_Mono, Lora } from 'next/font/google'
import { authOptions } from '@/lib/auth'
import { APP_COMPANY, APP_NAME } from '@/lib/config'
import { isColorThemeKey } from '@/lib/colorThemes'
import { prisma } from '@/lib/db'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const lora = Lora({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-serif' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} · ${APP_COMPANY}`,
}

// Farbschema je Mandant (Stefan 2026-08-27, "mach mal noch eine Farbauswahl")
// — wird ganz oben im Wurzel-Layout ermittelt, damit die gewählte Farbe von
// der ersten gerenderten Sekunde an gilt (kein Flackern beim Nachladen).
// Bewusst getServerSession() direkt statt des strengeren getContext() (das
// wirft ohne Sitzung einen Fehler) — hier sind auch nicht angemeldete Seiten
// (Login) betroffen, die einfach beim Standardschema "marine" bleiben.
async function resolveColorTheme(): Promise<string> {
  try {
    const session = await getServerSession(authOptions)
    const tenantId = session?.user?.tenantId
    if (!tenantId) return 'marine'
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { colorTheme: true } })
    return tenant?.colorTheme && isColorThemeKey(tenant.colorTheme) ? tenant.colorTheme : 'marine'
  } catch {
    return 'marine'
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const colorTheme = await resolveColorTheme()
  return (
    <html lang="de" data-theme={colorTheme} data-bg="none">
      <body className={`${inter.variable} ${lora.variable} ${mono.variable} font-sans`}>
        {children}
      </body>
    </html>
  )
}
