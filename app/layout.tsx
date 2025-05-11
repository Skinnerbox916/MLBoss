import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Barlow_Condensed, Oswald } from 'next/font/google'
import ClientLayout from './components/layout/ClientLayout'
import { TeamProvider } from '@/app/utils/TeamContext'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })
const barlowCondensed = Barlow_Condensed({ 
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-barlow-condensed'
})
const oswald = Oswald({
  weight: ['700'],
  subsets: ['latin'],
  variable: '--font-oswald'
})

export const metadata: Metadata = {
  title: 'MLB Lineup Manager',
  description: 'Manage your MLB lineups with ease',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className={`${inter.className} ${barlowCondensed.variable} ${oswald.variable} bg-white`}>
        <Providers>
          <TeamProvider>
            <ClientLayout>
              {children}
            </ClientLayout>
          </TeamProvider>
        </Providers>
      </body>
    </html>
  )
} 