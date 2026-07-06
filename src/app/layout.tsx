import type { Metadata } from 'next'
import { Inter, JetBrains_Mono, Lora } from 'next/font/google'
import { APP_COMPANY, APP_NAME } from '@/lib/config'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const lora = Lora({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-serif' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} · ${APP_COMPANY}`,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" data-theme="marine" data-bg="none">
      <body className={`${inter.variable} ${lora.variable} ${mono.variable} font-sans`}>
        {children}
      </body>
    </html>
  )
}
