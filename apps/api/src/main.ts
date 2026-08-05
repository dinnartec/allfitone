/**
 * Entry point on Vercel Functions.
 *
 * Runtime: Node (see vercel.json). Bun is the toolchain — install, test, run TS
 * in development — but not the production runtime: Fluid Compute's optimized
 * concurrency, which is what prevents cold starts, covers only Node and Python
 * today.
 *
 * Revisit when Vercel extends it to Bun.
 */
import { createApp } from './app.js'

export default createApp()
