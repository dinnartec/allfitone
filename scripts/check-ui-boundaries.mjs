import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { ESLint } from 'eslint'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const appRoots = ['apps/studio-web/src', 'apps/backoffice-web/src']
const forbiddenStyleExtensions = new Set([
  '.css',
  '.less',
  '.pcss',
  '.sass',
  '.scss',
  '.styl',
  '.stylus',
  '.svg',
])

const violations = []
// A colour name only counts when it stands alone. With `\b` on both sides the
// perfectly ordinary `white-space: nowrap` was reported as a literal colour,
// because `white` ends at the hyphen.
const rawColorPattern =
  /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)(?![\w-])/i
const dataSlotSelectorPattern = /\[\s*data-slot(?:\s*[~|^$*]?=|\s*\])/i
const directInteractiveSelectorPattern =
  /(^|[\s>+~,])(?:button|input|select|textarea|table|dialog)(?=$|[\s>+~,.#:[\]])/i

function isProductCompositionStylesheet(repositoryPath) {
  // Product-specific page composition may consume published tokens and primitives;
  // reusable primitives, assets and arbitrary component styles remain forbidden.
  return /^apps\/(?:studio-web|backoffice-web)\/src\/app\/[a-z0-9-]+\.composition\.css$/.test(
    repositoryPath,
  )
}

async function inspectDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name)
    const repositoryPath = relative(repositoryRoot, absolutePath).split(sep).join('/')

    if (entry.isDirectory()) {
      if (repositoryPath.includes('/src/components/ui')) {
        violations.push(`${repositoryPath}: local UI primitive directories are forbidden`)
        continue
      }

      await inspectDirectory(absolutePath)
      continue
    }

    if (
      entry.isFile() &&
      forbiddenStyleExtensions.has(extname(entry.name).toLowerCase()) &&
      !isProductCompositionStylesheet(repositoryPath)
    ) {
      violations.push(`${repositoryPath}: local UI assets and stylesheets are forbidden`)
    }

    if (entry.isFile() && isProductCompositionStylesheet(repositoryPath)) {
      inspectCompositionCss(repositoryPath, await readFile(absolutePath, 'utf8'))
    }
  }
}

function inspectCompositionCss(repositoryPath, source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')

  if (rawColorPattern.test(withoutComments)) {
    violations.push(`${repositoryPath}: literal colors are forbidden in composition CSS`)
  }
  if (dataSlotSelectorPattern.test(withoutComments)) {
    violations.push(`${repositoryPath}: Design System data-slot selectors are forbidden`)
  }

  for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1]?.trim() ?? ''
    if (!selector.startsWith('@') && directInteractiveSelectorPattern.test(selector)) {
      violations.push(`${repositoryPath}: direct interactive primitive selectors are forbidden`)
      break
    }
  }
}

async function verifyEslintBoundaryRule() {
  const eslint = new ESLint({ cwd: repositoryRoot })
  const invalid = await eslint.lintText(
    'export function Fixture(){return <><button>Save</button><input /></>}',
    { filePath: 'apps/studio-web/src/__ui-boundary-invalid__.tsx' },
  )
  const valid = await eslint.lintText(
    'export function Fixture(){return <form><input type="hidden" name="intent" /></form>}',
    { filePath: 'apps/backoffice-web/src/__ui-boundary-valid__.tsx' },
  )
  const invalidRuleIds = invalid.flatMap((result) =>
    result.messages.map((message) => message.ruleId),
  )

  if (
    invalidRuleIds.filter((ruleId) => ruleId === 'allfitone/no-visible-native-controls').length !==
      2 ||
    valid.some((result) =>
      result.messages.some((message) => message.ruleId === 'allfitone/no-visible-native-controls'),
    )
  ) {
    throw new Error(
      `ESLint UI boundary self-test failed: ${JSON.stringify({ invalidRuleIds, valid })}`,
    )
  }
}

async function verifyButtonSlotRule() {
  const ruleId = 'allfitone/button-variants-need-slot'
  const eslint = new ESLint({ cwd: repositoryRoot })
  const lint = async (source, name) => {
    const [result] = await eslint.lintText(source, {
      filePath: `apps/studio-web/src/${name}.tsx`,
    })
    return result.messages.filter((message) => message.ruleId === ruleId).length
  }

  const invalid = [
    // No slot: the link keeps the flat primary colour instead of the gradient.
    '<a href="/" className={buttonVariants()}>Go</a>',
    '<a href="/" data-slot="button" data-variant="default" className={buttonVariants({ variant: "outline" })}>Go</a>',
    '<a href="/" data-slot="button" className={buttonVariants({ variant: "outline" })}>Go</a>',
  ]
  const valid = [
    '<a href="/" data-slot="button" data-variant="default" className={buttonVariants({ size: "lg" })}>Go</a>',
    '<a href="/" data-slot="button" data-variant="outline" className={buttonVariants({ variant: "outline", size: "sm" })}>Go</a>',
    '<a href="/" data-slot="button" data-variant={kind} className={buttonVariants({ variant: kind })}>Go</a>',
    '<a href="/" className="plain">Go</a>',
  ]
  const wrap = (element) =>
    `import { buttonVariants } from '@allfitone/react/components/button'\nexport function Fixture({ kind }: { kind: 'outline' }) { return ${element} }`

  const missed = []
  for (const [index, element] of invalid.entries()) {
    if ((await lint(wrap(element), `__button-slot-invalid-${index}__`)) !== 1) missed.push(element)
  }
  for (const [index, element] of valid.entries()) {
    if ((await lint(wrap(element), `__button-slot-valid-${index}__`)) !== 0) missed.push(element)
  }
  if (missed.length > 0) {
    throw new Error(`ESLint button slot self-test failed on: ${missed.join(' | ')}`)
  }
}

function verifyCssBoundaryRules() {
  const initialCount = violations.length
  inspectCompositionCss(
    'apps/studio-web/src/app/__invalid.composition.css',
    '[data-slot="button"], button { color: red; background: rgb(0 0 0); }',
  )
  const testViolations = violations.splice(initialCount)
  const labels = [
    'literal colors are forbidden',
    'Design System data-slot selectors are forbidden',
    'direct interactive primitive selectors are forbidden',
  ]
  if (!labels.every((label) => testViolations.some((violation) => violation.includes(label)))) {
    throw new Error(`Composition CSS boundary self-test failed: ${testViolations.join('; ')}`)
  }

  inspectCompositionCss(
    'apps/studio-web/src/app/__valid.composition.css',
    '[data-studio-layout] { display: grid; gap: var(--afo-space-4); }',
  )
  // A hyphenated property that merely contains a colour name is legitimate.
  inspectCompositionCss(
    'apps/studio-web/src/app/__valid-hyphenated.composition.css',
    '[data-studio-code] { white-space: nowrap; color: var(--afo-color-text-muted); }',
  )
  if (violations.length !== initialCount) {
    throw new Error('Legitimate composition CSS failed the UI boundary self-test.')
  }
}

verifyCssBoundaryRules()
await verifyEslintBoundaryRule()
await verifyButtonSlotRule()

await Promise.all(appRoots.map((appRoot) => inspectDirectory(resolve(repositoryRoot, appRoot))))

if (violations.length > 0) {
  console.error('UI boundary violations:')
  for (const violation of violations.toSorted()) {
    console.error(`- ${violation}`)
  }
  process.exitCode = 1
} else {
  console.log('Studio and Backoffice UI boundaries are valid.')
}
