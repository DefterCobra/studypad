'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      // 'midnight' is a standalone class on <html> (see globals.css) — it must
      // be listed here or setTheme('midnight') won't stick
      themes={['light', 'dark', 'midnight', 'system']}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
