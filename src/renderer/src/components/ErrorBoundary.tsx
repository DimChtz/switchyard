import React from 'react'

/** Page errors outside React (event handlers, promises) go to the log file too. */
export function logPageErrors(): void {
  window.addEventListener('error', (e) => window.api.log.error('renderer', e.message || 'Error', e.error?.stack ?? `${e.filename}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined
    window.api.log.error('renderer', `Unhandled rejection: ${r?.message ?? String(e.reason)}`, r?.stack)
  })
}

interface Props {
  /** What broke, for the message ("the board", "this task's workspace"). */
  what: string
  /** A new value starts it over (e.g. the view or task changed). */
  resetKey?: string
  children: React.ReactNode
}

/**
 * A part of the app that threw while rendering shows this instead of taking
 * the whole window down: what happened, a way to try again, and the log.
 */
export class ErrorBoundary extends React.Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    window.api.log.error('renderer', `${this.props.what} crashed: ${error.message}`, `${error.stack ?? ''}\n${info.componentStack ?? ''}`)
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const link: React.CSSProperties = { color: 'var(--c-blue)', cursor: 'pointer' }
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 10, font: '13px/1.5 var(--font-ui)', color: 'var(--t2)' }}>
          <div style={{ font: '500 15px var(--font-ui)', color: 'var(--t1)' }}>Something went wrong in {this.props.what}</div>
          <div style={{ font: '12px/1.5 var(--font-mono)', color: 'var(--c-red)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error.message}</div>
          <div>
            The rest of Switchyard keeps working, and the details are in the log. <span style={link} onClick={() => this.setState({ error: null })}>Try again</span> ·{' '}
            <span style={link} onClick={() => window.api.log.openDir()}>
              Open logs folder
            </span>{' '}
            ·{' '}
            <span style={link} onClick={() => location.reload()}>
              Reload window
            </span>
          </div>
        </div>
      </div>
    )
  }
}
