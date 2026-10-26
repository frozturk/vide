const { chmodSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

if (process.platform !== 'win32') {
  const root = join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      const helper = join(root, entry, 'spawn-helper')
      if (existsSync(helper)) chmodSync(helper, 0o755)
    }
  }
}
