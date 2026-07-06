import { Role } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/auth/login')
  redirect(session.user.role === Role.OPERATOR_ADMIN ? '/platform' : '/dashboard')
}
