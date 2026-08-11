import { handle } from 'hono/vercel'

import { app } from '../../src/main.js'

export default handle(app)
