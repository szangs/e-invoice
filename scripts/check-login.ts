// Diagnose: zeigt alle Benutzer und prüft optional E-Mail + Passwort direkt gegen die DB.
// Aufruf:  npx tsx scripts/check-login.ts                     → Benutzerliste
//          npx tsx scripts/check-login.ts "mail" "passwort"   → Passwort-Test
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

function loadEnvLocal(): void {
  if (process.env.DATABASE_URL) return
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    /* optional */
  }
}

async function main() {
  loadEnvLocal()
  const prisma = new PrismaClient()
  try {
    const users = await prisma.user.findMany({ include: { tenant: true } })
    console.log(`${users.length} Benutzer in der Datenbank:`)
    for (const u of users) {
      console.log(
        `- ${u.email} · Rolle ${u.role} · ${u.active ? 'aktiv' : 'DEAKTIVIERT'} · Mandant: ${
          u.tenant ? `${u.tenant.name}${u.tenant.active ? '' : ' (GESPERRT)'}` : 'Betreiber-Ebene'
        }`,
      )
    }
    const maintenance = await prisma.systemSetting.findUnique({ where: { key: 'MAINTENANCE_LOCK' } })
    if (maintenance?.value === '1') console.log('ACHTUNG: Wartungssperre ist AKTIV — nur Betreiber kann sich anmelden!')

    const [email, password] = [process.argv[2], process.argv[3]]
    if (email && password) {
      const candidates = users.filter((u) => u.email === email.trim().toLowerCase())
      if (candidates.length === 0) {
        console.log(`\nKein Benutzer mit E-Mail "${email}" gefunden (Achtung: Groß-/Kleinschreibung der DB-Werte oben vergleichen).`)
      } else {
        for (const u of candidates) {
          const ok = bcrypt.compareSync(password, u.passwordHash)
          console.log(`\nPasswort-Test für ${u.email} (${u.tenant?.name ?? 'Betreiber'}): ${ok ? 'PASST' : 'FALSCH'}`)
        }
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
