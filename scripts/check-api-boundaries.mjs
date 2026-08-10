import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const eslint = new ESLint({ cwd: root })

const [invalidResult] = await eslint.lintText(
  "import { StudioSessionError } from '../../identity/application/index.js'\nvoid StudioSessionError\n",
  {
    filePath: path.join(root, 'apps/api/src/domains/catalog/handlers/__boundary-invalid__.ts'),
  },
)
const [validResult] = await eslint.lintText(
  "import { StudioSessionError } from '../../identity/index.js'\nvoid StudioSessionError\n",
  {
    filePath: path.join(root, 'apps/api/src/domains/catalog/handlers/__boundary-valid__.ts'),
  },
)

const boundaryRuleId = 'no-restricted-imports'
const invalidRuleIds = invalidResult?.messages.map(({ ruleId }) => ruleId) ?? []
const validRuleIds = validResult?.messages.map(({ ruleId }) => ruleId) ?? []

if (!invalidRuleIds.includes(boundaryRuleId)) {
  throw new Error(`Invalid cross-domain handler import did not report ${boundaryRuleId}`)
}
if (validRuleIds.includes(boundaryRuleId)) {
  throw new Error(`Public cross-domain import incorrectly reported ${boundaryRuleId}`)
}

console.log(`API boundary rule verified: ${boundaryRuleId}`)
