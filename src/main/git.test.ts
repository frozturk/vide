import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createWorktree, listBranches, listWorktreeBranches, removeWorktree, worktreeStatus } from './git'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('workspace worktrees', () => {
  it('lists branches by commit date and rejects a missing base without creating a worktree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vide-branches-test-'))
    try {
      git(root, 'init', '-b', 'main')
      git(root, 'config', 'user.email', 'vide@example.test')
      git(root, 'config', 'user.name', 'Vide Test')
      for (const [branch, date] of [['main', '2024-01-01'], ['z-recent', '2024-03-01'], ['a-older', '2024-02-01']]) {
        if (branch !== 'main') git(root, 'checkout', '-b', branch, 'main')
        execFileSync('git', ['commit', '--allow-empty', '-m', branch], {
          cwd: root, stdio: 'ignore',
          env: { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` }
        })
      }
      expect(await listBranches(root)).toEqual(['z-recent', 'a-older', 'main'])
      git(root, 'update-ref', 'refs/remotes/origin/recent', 'z-recent')
      git(root, 'update-ref', 'refs/remotes/origin/main', 'main')
      git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
      git(root, 'update-ref', 'refs/remotes/upstream/other', 'z-recent')
      git(root, 'branch', 'origin/recent', 'main')
      const branches = await listWorktreeBranches(root)
      expect(branches.map((branch) => branch.ref)).toEqual([
        'refs/heads/z-recent', 'refs/remotes/origin/recent', 'refs/heads/a-older',
        'refs/heads/main', 'refs/heads/origin/recent', 'refs/remotes/origin/main'
      ])
      expect(branches.find((branch) => branch.ref === 'refs/remotes/origin/recent')?.name).toBe('origin/recent')
      const remote = await createWorktree(root, 'workspace', 'from-origin', 'refs/remotes/origin/recent')
      const local = await createWorktree(root, 'workspace', 'from-local', 'refs/heads/origin/recent')
      expect(remote.baseSha).toBe(execFileSync('git', ['rev-parse', 'z-recent'], { cwd: root, encoding: 'utf8' }).trim())
      expect(local.baseSha).toBe(execFileSync('git', ['rev-parse', 'main'], { cwd: root, encoding: 'utf8' }).trim())
      expect(remote.baseSha).not.toBe(local.baseSha)
      expect(await worktreeStatus(remote.path, remote.baseSha)).toEqual({ dirty: false, hasOwnCommits: false })
      const beforeBranches = await listBranches(root)
      const before = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' })
      await expect(createWorktree(root, 'workspace', 'missing-base', 'deleted-branch')).rejects.toThrow('Base branch no longer exists: deleted-branch')
      expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe(before)
      expect(await listBranches(root)).toEqual(beforeBranches)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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
