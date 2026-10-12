import { describe, expect, it, vi } from 'vitest'

vi.mock('./pty', () => ({ runningSessions: () => [], exists: () => false, kill: () => {} }))
vi.mock('./log', () => ({ log: { warn: () => {} } }))

const { buildSnapshot, elapsed, parseLsof, parseNetstat, parsePs, parseSs, parseWinTable } = await import('./processes')

describe('process table parsing', () => {
  it('reads PowerShell rows (Windows)', () => {
    const ft = (Date.UTC(2026, 0, 1) + 11_644_473_600_000) * 10_000
    const [p] = parseWinTable(`1234\t100\t2048000\t${ft}\tnode.exe\t"C:\\node.exe" server.js\t--flag\r\n\r\n`)
    expect(p).toEqual({ pid: 1234, ppid: 100, name: 'node.exe', cmd: '"C:\\node.exe" server.js\t--flag', mem: 2048000, created: Date.UTC(2026, 0, 1) })
  })
  it('reads ps rows (macOS, Linux)', () => {
    const [p] = parsePs('  4321   1  10240     01:02:03 /usr/local/bin/node /app/server.js --port 5173\n', 10_000_000)
    expect(p).toMatchObject({ pid: 4321, ppid: 1, name: 'node', mem: 10240 * 1024, cmd: '/usr/local/bin/node /app/server.js --port 5173' })
    expect(p.created).toBe(10_000_000 - 3_723_000)
  })
  it('reads elapsed times', () => {
    expect(elapsed('05')).toBe(5000)
    expect(elapsed('01:05')).toBe(65_000)
    expect(elapsed('2-01:00:00')).toBe((48 + 1) * 3_600_000)
  })
})

describe('listening ports', () => {
  it('from netstat (IPv4 and IPv6, listening only)', () => {
    const out = [
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       900',
      '  TCP    [::]:5173              [::]:0                 LISTENING       900',
      '  TCP    127.0.0.1:9229         0.0.0.0:0              LISTENING       900',
      '  TCP    127.0.0.1:50000        127.0.0.1:5173         ESTABLISHED     77',
      '  UDP    0.0.0.0:5353           *:*                                    12'
    ].join('\r\n')
    expect([...parseNetstat(out)]).toEqual([[900, [5173, 9229]]])
  })
  it('from lsof and ss', () => {
    expect([...parseLsof('p900\nf20\nn*:5173\nf21\nn127.0.0.1:9229\np12\nn[::1]:3000\n')]).toEqual([
      [900, [5173, 9229]],
      [12, [3000]]
    ])
    expect([...parseSs('LISTEN 0 511 *:5173 *:* users:(("node",pid=900,fd=20))\nLISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:* \n')]).toEqual([[900, [5173]]])
  })
})

describe('buildSnapshot', () => {
  const proc = (pid: number, ppid: number, name: string, created = 1000): { pid: number; ppid: number; name: string; cmd: string; mem: number; created: number } => ({ pid, ppid, name, cmd: name, mem: 100, created })

  it("groups each terminal's process tree, with its ports and memory", () => {
    const table = [proc(10, 1, 'cmd.exe'), proc(11, 10, 'node.exe', 2000), proc(12, 11, 'esbuild.exe', 3000), proc(99, 1, 'other.exe')]
    const snap = buildSnapshot([{ id: 'preview-T1', pid: 10, cwd: '/w', startedAt: 5 }], table, new Map([[11, [5173]]]), 42)
    expect(snap.groups[0]).toMatchObject({ sessionId: 'preview-T1', ports: [5173], mem: 300 })
    expect(snap.groups[0].procs.map((p) => [p.name, p.depth])).toEqual([
      ['cmd.exe', 0],
      ['node.exe', 1],
      ['esbuild.exe', 2]
    ])
    expect(snap.orphans).toEqual([])
  })

  it('ignores a "child" older than its parent (a reused process id)', () => {
    const table = [proc(10, 1, 'pwsh.exe', 50_000), proc(11, 10, 'old.exe', 1000)]
    const snap = buildSnapshot([{ id: 'T1-shell-1', pid: 10, cwd: '/w', startedAt: 5 }], table, new Map())
    expect(snap.groups[0].procs.map((p) => p.name)).toEqual(['pwsh.exe'])
  })

  it('lists what kept running after its terminal ended', () => {
    const before = [proc(20, 1, 'cmd.exe'), proc(21, 20, 'node.exe', 2000), proc(22, 21, 'vite.exe', 3000)]
    buildSnapshot([{ id: 'preview-T2', pid: 20, cwd: '/w', startedAt: 5 }], before, new Map())
    // The terminal is gone; node and its child still run.
    const after = [proc(21, 20, 'node.exe', 2000), proc(22, 21, 'vite.exe', 3000)]
    const snap = buildSnapshot([], after, new Map([[22, [4000]]]))
    expect(snap.orphans).toHaveLength(1)
    expect(snap.orphans[0]).toMatchObject({ sessionId: 'preview-T2', ports: [4000] })
    expect(snap.orphans[0].procs.map((p) => p.name)).toEqual(['node.exe', 'vite.exe'])
    // Once it ends, it's forgotten.
    expect(buildSnapshot([], [], new Map()).orphans).toEqual([])
  })
})
