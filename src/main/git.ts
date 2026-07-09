import { appendFile, mkdir, readFile, rm, stat } from 'fs/promises'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { promisify } from 'util'
import type { DiffFile, DiffResult, GitSummary, OrphanWorktree, WorktreeStatus } from '../shared/types'

const exec = promisify(execFile)
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_UNTRACKED = 200
const MAX_FILE_SIZE = 1024 * 1024

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return null
  }
}

async function mainRepoRoot(cwd: string): Promise<string> {
  const common = (await git(cwd, ['rev-parse', '--git-common-dir'])).trim()
  return dirname(isAbsolute(common) ? common : resolve(cwd, common))
}

export async function projectRootOf(cwd: string): Promise<string> {
  try {
    return await mainRepoRoot(cwd)
  } catch {
    return cwd
  }
}

async function headSha(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['rev-parse', '--verify', 'HEAD'])).trim()
  } catch {
    return null
  }
}

export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  } catch {
    return null
  }
}

export async function createWorktree(
  agentCwd: string,
  kindId: string,
  customName?: string
): Promise<{ path: string; branch: string; baseSha: string }> {
  const root = await mainRepoRoot(agentCwd)
  const sha = await headSha(agentCwd)
  if (!sha) throw new Error('repository has no commits')
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('')
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join('')
  const suffix = `${kindId}-${stamp}-${time}`
  const slug = customName ? customName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) : suffix
  const branch = `vide/${slug}`
  const path = join(root, '.vide', 'worktrees', slug)
  await mkdir(dirname(path), { recursive: true })
  await ensureGitignore(root, '.vide/worktrees/')
  try {
    await git(root, ['worktree', 'add', '-b', branch, path, sha])
  } catch {
    await git(root, ['worktree', 'prune'])
    await git(root, ['worktree', 'add', '-b', branch, path, sha])
  }
  return { path, branch, baseSha: sha }
}

export async function worktreeStatus(path: string, baseSha?: string): Promise<WorktreeStatus> {
  const out = await git(path, ['--no-optional-locks', 'status', '--porcelain=v2'])
  const head = await headSha(path)
  return {
    dirty: out.trim() !== '',
    hasOwnCommits: baseSha ? head !== baseSha : true
  }
}

export async function removeWorktree(opts: {
  path: string
  branch?: string
  force: boolean
  deleteBranch: boolean
}): Promise<{ branchKept: boolean }> {
  const root = await mainRepoRoot(opts.path).catch(() => null)
  if (!root) return { branchKept: !!opts.branch }
  if (resolve(opts.path) === resolve(root)) throw new Error('refusing to remove the main worktree')
  try {
    const args = ['worktree', 'remove']
    if (opts.force) args.push('--force')
    args.push(opts.path)
    await git(root, args)
  } catch (err) {
    if (!opts.force) throw err
    await rm(opts.path, { recursive: true, force: true })
    await git(root, ['worktree', 'prune'])
  }
  if (opts.deleteBranch && opts.branch) {
    try {
      await git(root, ['branch', '-D', opts.branch])
      return { branchKept: false }
    } catch {
      return { branchKept: true }
    }
  }
  return { branchKept: !!opts.branch }
}

export async function orphanWorktrees(cwd: string, livePaths: string[]): Promise<OrphanWorktree[]> {
  const root = await mainRepoRoot(cwd).catch(() => null)
  if (!root) return []
  try {
    await git(root, ['worktree', 'prune'])
  } catch {
    /* best effort */
  }
  const out = await git(root, ['worktree', 'list', '--porcelain'])
  const result: OrphanWorktree[] = []
  let path = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    if (
      line.startsWith('branch refs/heads/vide/') &&
      path &&
      resolve(path) !== resolve(root) &&
      !livePaths.includes(path)
    ) {
      result.push({ path, branch: line.slice('branch refs/heads/'.length) })
    }
  }
  return result
}

export async function statusHash(cwd: string): Promise<string> {
  const root = await repoRoot(cwd)
  if (!root) return 'no-repo'
  const out = await git(root, ['--no-optional-locks', 'status', '--porcelain=v2', '-z'])
  const base = (await headSha(root)) ? 'HEAD' : EMPTY_TREE
  const diffStat = await git(root, ['--no-optional-locks', 'diff', base, '--stat', '--no-color']).catch(() => '')
  let untrackedSig = ''
  let seenUntracked = 0
  for (const t of out.split('\0')) {
    if (!t.startsWith('? ')) continue
    if (++seenUntracked > MAX_UNTRACKED) break
    const p = t.slice(2)
    try {
      const info = await stat(join(root, p))
      untrackedSig += `${p}:${info.mtimeMs}:${info.size};`
    } catch {
      untrackedSig += `${p}:gone;`
    }
  }
  return createHash('sha1').update(out).update(diffStat).update(untrackedSig).digest('hex')
}

const inflight = new Map<string, Promise<DiffResult>>()

export function getDiff(cwd: string): Promise<DiffResult> {
  const existing = inflight.get(cwd)
  if (existing) return existing
  const p = computeDiff(cwd).finally(() => inflight.delete(cwd))
  inflight.set(cwd, p)
  return p
}

async function computeDiff(cwd: string): Promise<DiffResult> {
  const root = await repoRoot(cwd)
  if (!root) return { kind: 'no-repo' }
  const base = (await headSha(root)) ? 'HEAD' : EMPTY_TREE
  const statusOut = await git(root, [
    '-c',
    'core.quotePath=false',
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '-z'
  ])
  const { statusByPath, untracked } = parseStatus(statusOut)
  const diffOut = await git(root, [
    '-c',
    'core.quotePath=false',
    'diff',
    base,
    '--unified=3',
    '--no-color',
    '--find-renames',
    '--no-ext-diff'
  ])
  const files: DiffFile[] = splitDiff(diffOut).map((chunk) => ({
    path: chunk.path,
    status: statusByPath.get(chunk.path) ?? 'modified',
    hunks: chunk.text
  }))
  let truncated = 0
  for (const [i, path] of untracked.entries()) {
    if (i >= MAX_UNTRACKED) {
      truncated = untracked.length - MAX_UNTRACKED
      break
    }
    files.push(await untrackedDiff(root, path))
  }
  return { kind: 'ok', files, truncated }
}

function parseStatus(out: string): {
  statusByPath: Map<string, DiffFile['status']>
  untracked: string[]
} {
  const statusByPath = new Map<string, DiffFile['status']>()
  const untracked: string[] = []
  const tokens = out.split('\0').filter(Boolean)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startsWith('1 ')) {
      const fields = t.split(' ')
      statusByPath.set(fields.slice(8).join(' '), xyToStatus(fields[1]))
    } else if (t.startsWith('2 ')) {
      const fields = t.split(' ')
      statusByPath.set(fields.slice(9).join(' '), 'renamed')
      i++
    } else if (t.startsWith('u ')) {
      const fields = t.split(' ')
      statusByPath.set(fields.slice(10).join(' '), 'modified')
    } else if (t.startsWith('? ')) {
      untracked.push(t.slice(2))
    }
  }
  return { statusByPath, untracked }
}

function xyToStatus(xy: string): DiffFile['status'] {
  if (xy.includes('A')) return 'added'
  if (xy.includes('D')) return 'deleted'
  return 'modified'
}

function unquoteGitPath(s: string): string {
  return s.replace(/\\(\\|"|t|n|[0-7]{1,3})/g, (_m, esc: string) => {
    if (esc === '\\') return '\\'
    if (esc === '"') return '"'
    if (esc === 't') return '\t'
    if (esc === 'n') return '\n'
    return String.fromCharCode(parseInt(esc, 8))
  })
}

function chunkPath(text: string): string | undefined {
  const quoted =
    text.match(/^\+\+\+ "b\/((?:\\.|[^"\\])*)"$/m) ?? text.match(/^--- "a\/((?:\\.|[^"\\])*)"$/m)
  if (quoted) return unquoteGitPath(quoted[1])
  const plus = text.match(/^\+\+\+ b\/(.+?)\t?$/m)?.[1]
  const minus = text.match(/^--- a\/(.+?)\t?$/m)?.[1]
  const header = text.match(/^diff --git a\/.+ b\/(.+)$/m)?.[1]
  return plus ?? minus ?? header
}

function splitDiff(out: string): { path: string; text: string }[] {
  const chunks: { path: string; text: string }[] = []
  const parts = out.split(/^(?=diff --git )/m)
  for (const text of parts) {
    if (!text.startsWith('diff --git ')) continue
    const path = chunkPath(text)
    if (path) chunks.push({ path, text })
  }
  return chunks
}

async function untrackedDiff(root: string, path: string): Promise<DiffFile> {
  const placeholder: DiffFile = { path, status: 'untracked', hunks: '' }
  let info
  try {
    info = await stat(join(root, path))
  } catch {
    return placeholder
  }
  if (!info.isFile() || info.size > MAX_FILE_SIZE) return placeholder
  try {
    await exec(
      'git',
      ['-c', 'core.quotePath=false', 'diff', '--no-index', '--unified=3', '--no-color', '--', '/dev/null', path],
      { cwd: root, maxBuffer: 16 * 1024 * 1024 }
    )
    return placeholder
  } catch (err) {
    const e = err as { code?: number; stdout?: string }
    if (e.code === 1 && typeof e.stdout === 'string' && !/^Binary files /m.test(e.stdout)) {
      return { path, status: 'untracked', hunks: e.stdout }
    }
    return placeholder
  }
}

export async function gitSummary(cwd: string): Promise<GitSummary> {
  const root = await repoRoot(cwd).catch(() => null)
  if (!root) {
    return { branch: null, dirty: false, ahead: 0, behind: 0, modified: 0, staged: 0, untracked: 0 }
  }
  const branch = await currentBranch(cwd).catch(() => null)
  let status = ''
  try {
    status = await git(cwd, ['--no-optional-locks', 'status', '--porcelain=v2'])
  } catch {
    /* ignore */
  }
  let ahead = 0
  let behind = 0
  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.ab ')) {
      const parts = line.split(' ')
      if (parts[2] === '+') ahead = parseInt(parts[3], 10) || 0
      if (parts.length > 4 && parts[4] === '-') behind = parseInt(parts[5], 10) || 0
    }
  }
  let modified = 0
  let staged = 0
  let untracked = 0
  for (const line of status.split('\n')) {
    if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const xy = line.split(' ')[1] ?? ''
      if (xy[0] !== '.' && xy[0] !== '?') staged++
      if (xy[1] !== '.') modified++
    } else if (line.startsWith('? ')) {
      untracked++
    }
  }
  return {
    branch,
    dirty: status.trim() !== '',
    ahead,
    behind,
    modified,
    staged,
    untracked
  }
}

async function ensureGitignore(root: string, entry: string): Promise<void> {
  const gitignore = join(root, '.gitignore')
  let content = ''
  try {
    content = await readFile(gitignore, 'utf8')
  } catch {
    /* no .gitignore */
  }
  if (content.includes(entry)) return
  const prefix = content && !content.endsWith('\n') ? '\n' : ''
  await appendFile(gitignore, `${prefix}${entry}\n`, 'utf8')
}
