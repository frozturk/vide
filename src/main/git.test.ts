import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createWorktree, removeWorktree, worktreeStatus } from './git'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('workspace worktrees', () => {
  it('creates unique workspaces and reports dirty and committed work', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vide-workspace-test-'))
    git(root, 'init')
    git(root, 'config', 'user.email', 'vide@example.test')
    git(root, 'config', 'user.name', 'Vide Test')
    writeFileSync(join(root, 'README.md'), 'initial\n')
    git(root, 'add', 'README.md')
    git(root, 'commit', '-m', 'initial')

    const first = await createWorktree(root, 'workspace', 'auth feature')
    const second = await createWorktree(root, 'workspace', 'auth feature')
    expect(first.name).toBe('auth-feature')
    expect(second.name).toBe('auth-feature-2')
    expect(await worktreeStatus(first.path, first.baseSha)).toEqual({ dirty: false, hasOwnCommits: false })

    writeFileSync(join(first.path, 'README.md'), 'changed\n')
    expect((await worktreeStatus(first.path, first.baseSha)).dirty).toBe(true)
    git(first.path, 'add', 'README.md')
    git(first.path, 'commit', '-m', 'change')
    expect(await worktreeStatus(first.path, first.baseSha)).toEqual({ dirty: false, hasOwnCommits: true })

    const removed = await removeWorktree({ path: first.path, branch: first.branch, force: false, deleteBranch: false })
    expect(removed.branchKept).toBe(true)
    expect(() => execFileSync('git', ['show-ref', '--verify', `refs/heads/${first.branch}`], { cwd: root, stdio: 'ignore' })).not.toThrow()

    await removeWorktree({ path: second.path, branch: second.branch, force: false, deleteBranch: true })
    expect(() => execFileSync('git', ['show-ref', '--verify', `refs/heads/${second.branch}`], { cwd: root, stdio: 'ignore' })).toThrow()
  })
})
