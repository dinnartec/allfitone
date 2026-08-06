/**
 * Entry point on Vercel Functions.
 *
 * Vercel detects `src/index.ts` as a Hono application without framework-specific
 * configuration. Bun remains the toolchain for installs, tests and local
 * TypeScript execution; the deployed function uses Vercel's Node.js runtime.
 */
import { Hono } from 'hono'

import { createApp } from './application.js'

export default createApp(new Hono())
