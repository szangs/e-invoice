// Seed: legt den Betreiber-Administrator und einen Demo-Mandanten an.
// Aufruf:  npx prisma db seed   (liest .env.local NICHT automatisch — Werte kommen aus .env
// oder werden vorher gesetzt; siehe README Abschnitt "Erststart")
import { readFileSync } from 'fs'
import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

// .env.local selbst laden — die Prisma-CLI liest nur .env, nicht .env.local
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {
  /* .env.local optional — Werte können auch aus der Umgebung kommen */
}

const prisma = new PrismaClient()

async function main() {
  const opEmail = process.env.SEED_OPERATOR_EMAIL ?? 'stefan.zangs@deltaplus.de'
  const opPassword = process.env.SEED_OPERATOR_PASSWORD ?? 'start1234!'

  // Betreiber-Administrator (keinem Mandanten zugeordnet, §2)
  const operator = await prisma.user.upsert({
    where: { username: 'operator' },
    update: {},
    create: {
      tenantId: null,
      email: opEmail.toLowerCase(),
      username: 'operator',
      passwordHash: await bcrypt.hash(opPassword, 10),
      role: Role.OPERATOR_ADMIN,
      active: true,
    },
  })

  // Demo-Mandant mit erstem Administrator
  const demo = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      slug: 'demo',
      name: 'Demo GmbH',
      contactEmail: 'demo@example.org',
      employeeCount: 12,
      maxUsers: 5,
      aiAllowed: false,
    },
  })

  await prisma.user.upsert({
    where: { username: 'demo-admin' },
    update: {},
    create: {
      tenantId: demo.id,
      email: 'admin@demo.example.org',
      username: 'demo-admin',
      passwordHash: await bcrypt.hash('demo1234!', 10),
      role: Role.TENANT_ADMIN,
      active: true,
    },
  })

  console.log('Seed fertig.')
  console.log(`Betreiber-Login:  ${operator.email}  (Passwort aus SEED_OPERATOR_PASSWORD)`)
  console.log('Demo-Mandant:     admin@demo.example.org / demo1234!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
