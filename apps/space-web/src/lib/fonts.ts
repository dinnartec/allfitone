import { Barlow_Condensed, Manrope } from 'next/font/google'

/** Shared by the language root layout and the global 404, which renders outside it. */
export const display = Barlow_Condensed({
  subsets: ['latin'],
  variable: '--afo-app-font-display',
  weight: ['500', '600', '700'],
})

export const body = Manrope({
  subsets: ['latin'],
  variable: '--afo-app-font-body',
})
