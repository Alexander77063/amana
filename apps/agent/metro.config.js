const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Resolve @amana/* workspace packages directly from TypeScript source
// (dist/ is gitignored and not uploaded to EAS build servers)
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@amana/')) {
    const pkgName = moduleName.replace('@amana/', '');
    return {
      filePath: path.resolve(workspaceRoot, 'packages', pkgName, 'src', 'index.ts'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
