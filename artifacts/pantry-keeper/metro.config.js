const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the workspace root (monorepo root)
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all files in the monorepo
config.watchFolders = [workspaceRoot];

// Resolve node_modules from both the project and workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Ensure the main fields are resolved for react-native
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
