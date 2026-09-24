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

const config = getDefaultConfig(projectRoot)

// Watch the whole workspace so a change in packages/ triggers a reload.
config.watchFolders = [workspaceRoot]

// Resolve from the app first, then from the hoisted root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// Without this, a package hoisted to the root can be loaded twice — once per
// resolution path — which breaks React and any library holding module state.
config.resolver.disableHierarchicalLookup = true

module.exports = config
