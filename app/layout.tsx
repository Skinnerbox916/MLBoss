import './globals.css'
import type { Metadata } from 'next'
import Image from 'next/image'

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
      <body className="bg-white">
        <header className="bg-white shadow-sm">
          <div className="max-w-4xl mx-auto py-4 px-8 flex justify-center">
            <Image
              src="/MLBoss Logo.png"
              alt="MLBoss Logo"
              width={160}
              height={0}
              style={{ height: 'auto' }}
              priority
            />
          </div>
        </header>
        {children}
      </body>
    </html>
  )
} 