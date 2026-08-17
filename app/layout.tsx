import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
// Section 9 Terminal: headlines, labels and buttons read as a technical
// readout rather than a display wordmark, so the "display" role is a
// monospace face instead of Orbitron.
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jetbrains-mono',
})

export const metadata: Metadata = {
  // Needed for per-page opengraph-image routes (see app/u/[username]/
  // opengraph-image.tsx) to resolve to an absolute URL — without this,
  // Next can only guess the deployment origin, which Next itself warns
  // about and can get wrong outside of Vercel's own inferred-URL cases.
  metadataBase: new URL('https://polis.somi.blaisot.org'),
  title: 'Polis - build your city from GitHub profile',
  description:
    'A generative night-city skyline where every building is a GitHub repository: height from commits, color from language, light from stars.',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0a0910',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-background font-sans antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
