// Metro in a monorepo.
//
// Metro does not walk up to the workspace root on its own, so without this it
// resolves neither the hoisted dependencies nor anything under packages/. Both
// settings are required; the symptom of missing either is an unresolved-module
// error that names a package which is plainly installed.

const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

/**
 * The Design System, read from its own repository while it is still being written.
 *
 * `DT-008` says a product installs an exact published version and forbids sibling
 * paths, and this is deliberately the other thing — a `file:` dependency in
 * `apps/space/package.json` pointing at the repo next door, so an edit there shows up
 * here without a release. **It has to be reverted before publishing.**
 *
 * It is here because the published `@allfitone/tokens@0.2.0` predates half the tokens
 * the app already uses: `screenTop` does not exist in it at all, so every screen was
 * resolving `paddingTop: undefined` and sitting flush against the safe area. Raising
 * the token could not fix that, because nothing was reading the token.
 *
 * Metro only watches what it is told to. Without this folder the symlinked package
 * resolves and then never reloads when its source changes.
 */
const designSystemRoot = path.resolve(projectRoot, '../../../allfitone-design-system')

const config = getDefaultConfig(projectRoot)

// Watch the whole workspace so a change in packages/ triggers a reload.
config.watchFolders = [workspaceRoot, designSystemRoot]

// Resolve from the app first, then from the hoisted root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// Without this, a package hoisted to the root can be loaded twice — once per
// resolution path — which breaks React and any library holding module state.
config.resolver.disableHierarchicalLookup = true

module.exports = config
