'use client'

// Befehlspalette (DP-Standard §11.2) — Strg+K / Cmd+K / Alt+K, kein Autosprung
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ALL_NAV_ITEMS, NavItem } from '@/lib/nav-config'

function filterItems(query: string): NavItem[] {
  if (!query) return ALL_NAV_ITEMS
  const q = query.toUpperCase()
  return ALL_NAV_ITEMS.filter((i) => i.code.startsWith(q) || i.label.toUpperCase().includes(q))
}

function parseInput(raw: string): { code: string; chain: string } {
  const [code, ...rest] = raw.split('/')
  return { code: code.trim(), chain: rest.join('/').trim() }
}

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { code, chain } = parseInput(query)
  const results = filterItems(code)

  const go = useCallback(
    (item: NavItem) => {
      setOpen(false)
      setQuery('')
      router.push(chain ? `${item.href}?q=${encodeURIComponent(chain)}` : item.href)
    },
    [router, chain],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (((e.ctrlKey || e.metaKey) && e.key === 'k') || (e.altKey && e.key === 'k')) {
        e.preventDefault()
        setOpen((v) => !v)
        setQuery('')
        setIndex(0)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 pt-24 print:hidden"
      onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg rounded-xl border border-[var(--line)] bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="w-full rounded-t-xl border-b border-[var(--line)] px-4 py-3 text-sm outline-none"
          placeholder="Code (z. B. RE01) oder Seitenname …"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, results.length - 1))
            if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0))
            if (e.key === 'Enter' && results[index]) go(results[index])
          }}
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {results.map((r, i) => (
            <li key={r.href}>
              <button
                className={`flex w-full items-center justify-between px-4 py-2 text-sm ${
                  i === index ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'text-gray-700'
                }`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(r)}
              >
                <span>{r.label}</span>
                <span className="text-[10px] font-mono opacity-50">{r.code}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-400">Kein Treffer</li>
          )}
        </ul>
        <p className="border-t border-[var(--line)] px-4 py-2 text-[10px] text-gray-300">
          ⌘K · Ctrl K · Alt K — Enter navigiert, Esc schließt
        </p>
      </div>
    </div>
  )
}
