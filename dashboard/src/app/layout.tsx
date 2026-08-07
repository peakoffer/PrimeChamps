import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { WorkspaceShell } from "@/components/WorkspaceShell";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-pc-body",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  variable: "--font-pc-display",
  weight: ["600", "700"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-pc-mono",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Prime Champs CRM",
  description: "Athlete research, partnerships, and outreach operations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${barlowCondensed.variable} ${ibmPlexMono.variable} antialiased`}>
        <WorkspaceShell>{children}</WorkspaceShell>
      </body>
    </html>
  );
}
