import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { Button, FooterNote, Modal, Toggle } from './ui'
import { closeInstall, usePendingInstall } from '../lib/plugins'
import { errText } from '../lib/errors'
import { compareVersions } from '@shared/plugins'

const kb = (n: number): string => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/**
 * "Install this plugin?" - for a package from a file, a link, a drop or a
 * double-click: what it is, what it adds, whether it replaces one, and that
 * its script runs with the user's permissions.
 */
export function PluginInstallDialog(): React.JSX.Element | null {
  const p = usePendingInstall()
  const { dispatch } = useAppStore()
  const [turnOn, setTurnOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const enter = useRef<() => void>(() => {})
  useEffect(() => {
    // An update keeps it as it was; a new one is turned on unless you say otherwise.
    setTurnOn(p?.current ? p.current.enabled : true)
    setBusy(false)
  }, [p?.token]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!p) return
    // Its keys only (the app's shortcuts wait): Esc cancels, Enter installs.
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        closeInstall()
      } else if (e.key === 'Enter' && !(e.target as HTMLElement | null)?.closest?.('button')) {
        e.preventDefault()
        enter.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [p])
  if (!p) return null

  const m = p.manifest
  const change = p.current ? compareVersions(p.current.version, m.version) : null
  const verb = change === null ? 'Install' : change < 0 ? 'Update' : change > 0 ? 'Downgrade' : 'Reinstall'
  const install = (): void => {
    setBusy(true)
    window.api.plugins
      .install(p.token, turnOn)
      .then(() => {
        closeInstall()
        dispatch({ type: 'TOAST', text: `${verb === 'Install' ? 'Installed' : verb === 'Update' ? 'Updated' : verb === 'Downgrade' ? 'Downgraded' : 'Reinstalled'} ${m.name} ${m.version}${turnOn ? '' : ' - turn it on in the list when you want it'}.` })
      })
      .catch((err: unknown) => {
        setBusy(false)
        dispatch({ type: 'TOAST', text: errText(err) })
      })
  }
  enter.current = () => {
    if (!p.problem && !busy) install()
  }
  const adds = [
    ...(m.commands ?? []).map((c) => ['Command', c.title]),
    ...(m.agents ?? []).map((a) => ['Agent', `${a.name} (runs ${a.bin})`])
  ]
  return (
    <Modal
      width={520}
      onClose={closeInstall}
      kicker={`${verb} plugin${p.current ? ` · ${p.current.version} → ${m.version}` : ''}`}
      title={`${m.name} ${m.version}`}
      footer={
        <>
          <FooterNote tone={p.problem ? 'danger' : undefined}>{p.problem ?? `${p.files} file${p.files === 1 ? '' : 's'} · ${kb(p.bytes)}`}</FooterNote>
          <Button onClick={closeInstall}>Cancel</Button>
          <Button variant="primary" hint="↵" disabled={!!p.problem || busy} onClick={install}>
            {busy ? `${verb === 'Install' ? 'Installing' : 'Updating'}…` : verb}
          </Button>
        </>
      }
    >
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto', font: '13px/1.5 var(--font-ui)', color: 'var(--t2)' }}>
        {m.description ? <div>{m.description}</div> : null}
        {adds.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 14, rowGap: 4 }}>
            {adds.map(([what, name], i) => (
              <React.Fragment key={i}>
                <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)' }}>{what}</span>
                <span style={{ color: 'var(--t1)' }}>{name}</span>
              </React.Fragment>
            ))}
          </div>
        ) : null}
        {m.main ? (
          <div style={{ border: '1px solid color-mix(in srgb, var(--c-amber) 40%, transparent)', background: 'color-mix(in srgb, var(--c-amber) 7%, transparent)', borderRadius: 6, padding: '9px 12px', color: 'var(--t1)' }}>
            It runs a script ({m.main}) on this computer with your permissions - it can read and change files and run programs, like a VS Code extension. Install plugins
            only from people you trust.
          </div>
        ) : null}
        <div style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)', overflowWrap: 'anywhere' }}>from {p.from}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--t1)', cursor: 'pointer' }}>
          <Toggle on={turnOn} onChange={setTurnOn} />
          {p.current ? 'Keep it on' : 'Turn it on now'}
        </label>
      </div>
    </Modal>
  )
}
