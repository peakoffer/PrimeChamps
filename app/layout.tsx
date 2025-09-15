import type React from "react"
import "./globals.css"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import Navigation from "@/components/navigation"
import Footer from "@/components/footer"
import { Toaster } from "@/components/ui/toaster"
// Import Script from next/script instead
import Script from "next/script"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Prime Champs | Elite Athlete Agency",
  description: "Representing and developing the next generation of sporting excellence",
    generator: 'v0.app'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <Navigation />
          <main className="min-h-screen">{children}</main>
          <Footer />
          <Toaster />
          {/* Use the script tag approach instead of the component */}
          <Script strategy="afterInteractive" src="https://va.vercel-scripts.com/v1/speed-insights/script.js" />
        </ThemeProvider>
      </body>
    </html>
  )
}
