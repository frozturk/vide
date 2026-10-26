const { existsSync } = require('node:fs')
const { join, delimiter } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = join(__dirname, '..')
if (!existsSync(join(root, 'litemux', 'Cargo.toml'))) {
  console.error('Fetch litemux first: git submodule update --init --recursive')
  process.exit(1)
}
const env = { ...process.env }
let cargo = 'cargo'
const localCargo = join(root, '.tools', 'cargo', 'bin', 'cargo.exe')
if (process.platform === 'win32' && existsSync(localCargo)) {
  cargo = localCargo
  env.CARGO_HOME = join(root, '.tools', 'cargo')
  env.RUSTUP_HOME = join(root, '.tools', 'rustup')
  env.PATH = [join(env.CARGO_HOME, 'bin'), env.PATH].join(delimiter)
  const toolchain = 'stable-x86_64-pc-windows-gnu'
  const compiler = join(root, '.tools', 'w64devkit', 'bin')
  if (existsSync(join(compiler, 'gcc.exe'))) {
    env.RUSTUP_TOOLCHAIN = toolchain
    env.PATH = [compiler, env.PATH].join(delimiter)
    // Use Rust's matching CRT/unwind libraries alongside MinGW's linker tools.
    env.RUSTFLAGS = `${env.RUSTFLAGS ?? ''} -C link-self-contained=yes`.trim()
  }
}
const result = spawnSync(cargo, [process.argv.includes('--test') ? 'test' : 'build', '--locked', '--release', '--manifest-path', 'litemux/Cargo.toml'], {
  cwd: root, env, stdio: 'inherit', windowsHide: true
})
if (result.error) console.error(`Cannot run Cargo: ${result.error.message}. Install Rust or restore the workspace .tools directory.`)
process.exit(result.status ?? 1)
