import { createServer, connect } from 'net'

/** A TCP port that's free right now, picked by the OS. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function tryConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port })
    const done = (ok: boolean): void => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(800, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

/** Whether something is accepting connections on this local port (IPv4 or IPv6). */
export async function portOpen(port: number): Promise<boolean> {
  return (await tryConnect('127.0.0.1', port)) || (await tryConnect('::1', port))
}
