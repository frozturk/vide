import { execFile } from 'child_process'
import { promisify } from 'util'
import type { LocalServer } from '../shared/types'

const exec = promisify(execFile)
const EPHEMERAL_PORT = 49152

export function parseListeners(output: string): Map<number, { command: string; addresses: string[] }> {
  const byPid = new Map<number, { command: string; addresses: string[] }>()
  let current: { command: string; addresses: string[] } | null = null
  for (const line of output.split('\n')) {
    const value = line.slice(1)
    if (line[0] === 'p') {
      current = { command: '', addresses: [] }
      byPid.set(Number(value), current)
    } else if (line[0] === 'c' && current) {
      current.command = value
    } else if (line[0] === 'n' && current && !current.addresses.includes(value)) {
      current.addresses.push(value)
    }
  }
  return byPid
}

export function parseCwds(output: string): Map<number, string> {
  const cwds = new Map<number, string>()
  let pid = 0
  for (const line of output.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    else if (line[0] === 'n' && pid) cwds.set(pid, line.slice(1))
  }
  return cwds
}

export function parseElapsed(etime: string): number {
  const [days, clock] = etime.includes('-') ? etime.split('-') : ['0', etime]
  const seconds = clock.split(':').reduce((total, part) => total * 60 + Number(part), 0)
  return (Number(days) * 86400 + seconds) * 1000
}

export function parseProcesses(output: string, now: number): Map<number, { args: string; startedAt: number }> {
  const processes = new Map<number, { args: string; startedAt: number }>()
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/)
    if (match) processes.set(Number(match[1]), { args: match[3], startedAt: now - parseElapsed(match[2]) })
  }
  return processes
}

function splitAddress(address: string): { host: string; port: number } {
  const i = address.lastIndexOf(':')
  return { host: address.slice(0, i), port: Number(address.slice(i + 1)) }
}

async function run(cmd: string, args: string[]): Promise<string> {
  try {
    return (await exec(cmd, args, { maxBuffer: 16 * 1024 * 1024 })).stdout
  } catch (err) {
    return (err as { stdout?: string }).stdout ?? ''
  }
}

export async function listLocalServers(): Promise<LocalServer[]> {
  const listeners = parseListeners(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']))
  const servers: LocalServer[] = []
  for (const [pid, l] of listeners) {
    const ports = l.addresses.map(splitAddress).filter((a) => a.port < EPHEMERAL_PORT)
    if (ports.length) servers.push({ pid, command: l.command, args: '', cwd: null, startedAt: null, ports })
  }
  if (!servers.length) return []
  const pids = servers.map((s) => s.pid).join(',')
  const [cwds, processes] = await Promise.all([
    run('lsof', ['-a', '-p', pids, '-d', 'cwd', '-Fpn']).then(parseCwds),
    run('ps', ['-o', 'pid=,etime=,args=', '-p', pids]).then((out) => parseProcesses(out, Date.now()))
  ])
  return servers
    .map((s) => ({ ...s, cwd: cwds.get(s.pid) ?? null, args: processes.get(s.pid)?.args ?? s.command, startedAt: processes.get(s.pid)?.startedAt ?? null }))
    .sort((a, b) => Number(b.command === 'node') - Number(a.command === 'node') || Math.min(...a.ports.map((p) => p.port)) - Math.min(...b.ports.map((p) => p.port)))
}

export function killLocalServer(pid: number, force: boolean): void {
  process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
}
