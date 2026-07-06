'use client'

// AppSidebar nach DP-Designsystem §4.6 — Single-Open-Akkordeon, Schnellcodes dezent
import { Role } from '@prisma/client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { DASHBOARD, NAV_GROUPS } from '@/lib/nav-config'

function isActive(pathname: string, href: string): boolean {
  const base = href.split('?')[0]
  return pathname === base || (base !== '/dashboard' && pathname.startsWith(base + '/'))
}

export function AppSidebar({ role }: { role: Role }) {
  const pathname = usePathname()
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  const isOperator = role === Role.OPERATOR_ADMIN
  const isTenantAdmin = role === Role.TENANT_ADMIN
  const groups = NAV_GROUPS.filter((g) => {
    if (g.operatorOnly && !isOperator) return false
    if (g.adminOnly && !(isTenantAdmin || isOperator)) return false
    return true
  })

  useEffect(() => {
    const active = groups.find((g) => g.items.some((i) => isActive(pathname, i.href)))
    if (active) setOpenGroup(active.title)
    setMobileOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const toggle = (title: string) => setOpenGroup((p) => (p === title ? null : title))

  const nav = (
    <nav className="px-3 py-2">
      {!isOperator && (
        <Link
          href={DASHBOARD.href}
          className={`mb-3 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
            isActive(pathname, DASHBOARD.href)
              ? 'bg-[var(--accent-bg)] font-semibold text-[var(--accent)]'
              : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          <NavIcon active={isActive(pathname, DASHBOARD.href)} />
          {DASHBOARD.label}
          <Code code={DASHBOARD.code} />
        </Link>
      )}
      {groups.map((g) => {
        const open = openGroup === g.title
        return (
          <div key={g.title} className={open ? 'my-2 rounded-xl bg-gray-50 py-1' : ''}>
            <button
              onClick={() => toggle(g.title)}
              className={`flex w-full items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-widest ${
                open ? 'text-gray-700' : 'text-gray-400 hover:text-gray-700'
              }`}
            >
              {g.title}
              <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none"
                stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {open &&
              g.items.map((i) => {
                const active = isActive(pathname, i.href)
                return (
                  <Link key={i.href} href={i.href}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                      active
                        ? 'bg-[var(--accent-bg)] font-semibold text-[var(--accent)]'
                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <NavIcon active={active} />
                    <span className="truncate">{i.label}</span>
                    <Code code={i.code} />
                  </Link>
                )
              })}
          </div>
        )
      })}
    </nav>
  )

  return (
    <>
      {/* Mobile-Hamburger wird in der Topbar erwartet — hier einfacher Toggle-Knopf */}
      <button
        className="fixed left-3 top-3 z-50 rounded-lg bg-white/80 p-2 text-gray-500 shadow lg:hidden print:hidden"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label="Menü"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <aside
        className={`fixed z-50 h-screen w-60 overflow-y-auto border-r border-[var(--line)] bg-[var(--surface-warm)] transition-transform lg:sticky lg:top-0 lg:translate-x-0 print:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 pb-4 pt-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] font-serif font-bold text-white">
              €
            </div>
            <div>
              <p className="text-[15px] font-bold leading-tight text-[var(--accent)]">E-Invoice</p>
              <p className="text-[11px] text-gray-400">Rechnungsautomatisierung</p>
            </div>
          </div>
        </div>
        {nav}
        <div className="mt-4 border-t border-[var(--line)] px-3 py-3">
          <button
            onClick={() => signOut({ callbackUrl: '/auth/login' })}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Abmelden
          </button>
          <p className="mt-2 px-3 text-[10px] font-mono text-gray-300">Strg+K · Befehlspalette</p>
        </div>
      </aside>
    </>
  )
}

function NavIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 ${active ? 'text-[var(--accent)]' : 'text-gray-400'}`}
      fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" />
    </svg>
  )
}

function Code({ code }: { code: string }) {
  return (
    <span className="ml-auto text-[8px] font-mono opacity-35" title={`Schnellnavigation / Strg+K → ${code} eingeben`}>
      {code}
    </span>
  )
}
