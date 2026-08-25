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

/** Escape a path (Windows separators included) for embedding in a RegExp. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const under = (...parts) => new RegExp(`${escapeRe(path.join(workspaceRoot, ...parts))}.*`);

/**
 * Keep Metro out of directories it has no business watching.
 *
 * `watchFolders` is the whole monorepo, so without this the file-map crawl also walks the demo
 * harness's video output (tens of megabytes of .webm/.mp4/.wav), the retailer portal's `.next`
 * build output, and coverage reports. That crawl has a hard four-minute ceiling inside
 * metro-file-map (`MAX_WAIT_TIME`), and once the Next app joined the workspace it started
 * exceeding it — at which point Metro does not start at all and reports "Failed to start watch
 * mode", which reads like a broken install rather than a slow directory walk.
 *
 * None of these contain modules anything imports.
 */
config.resolver.blockList = [
  under('tools', 'demo', 'out'),
  under('apps', 'retailer-portal', '.next'),
  under('coverage'),
  under('.claude', 'worktrees'),
];

module.exports = config;
