// Setzt das Passwort des Betreiber-Administrators neu.
// Aufruf:  npx tsx scripts/set-operator-password.ts "NeuesPasswort"
// Liest DATABASE_URL automatisch aus .env.local, falls nicht gesetzt.
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
    /* .env.local optional */
  }
}

async function main() {
  loadEnvLocal()
  const password = process.argv[2]
  if (!password || password.length < 10) {
    console.error('Bitte neues Passwort (min. 10 Zeichen) als Argument angeben:')
    console.error('  npx tsx scripts/set-operator-password.ts "NeuesPasswort"')
    process.exit(1)
  }
  const prisma = new PrismaClient()
  try {
    await prisma.user.update({
      where: { username: 'operator' },
      data: { passwordHash: bcrypt.hashSync(password, 10), forcedLogoutAt: new Date() },
    })
    console.log('Betreiber-Passwort geändert. Bestehende Sitzungen wurden beendet.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
