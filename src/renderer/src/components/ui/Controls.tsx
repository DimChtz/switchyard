import React, { forwardRef, useState } from 'react'
import { keyLabel } from '../../lib/keys'

/** A shortcut hint: "⌘K" as this platform writes it, in the muted mono style. */
export function Kbd({ k, style }: { k: string; style?: React.CSSProperties }): React.JSX.Element {
  return <span style={{ font: "11px var(--font-mono)", color: 'var(--t4)', whiteSpace: 'nowrap', ...style }}>{keyLabel(k)}</span>
}

/** The small uppercase heading over a group of rows or a list section. */
export function SectionLabel({ children, note, style }: { children: React.ReactNode; note?: React.ReactNode; style?: React.CSSProperties }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, ...style }}>
      <span style={{ font: "500 11px var(--font-mono)", letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', whiteSpace: 'nowrap' }}>{children}</span>
      {note ? <span style={{ font: '12px var(--font-ui)', color: 'var(--t4)' }}>{note}</span> : null}
    </div>
  )
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  /** Code-ish values (paths, commands, branch names). */
  mono?: boolean
  /** 26 · 28 · 30 high. */
  size?: 'sm' | 'md' | 'lg'
  invalid?: boolean
}

/** The text field: dark well, blue ring while focused, red when invalid. */
export const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput({ mono, size = 'lg', invalid, style, onFocus, onBlur, ...rest }, ref) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      ref={ref}
      spellCheck={false}
      {...rest}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      style={{
        height: size === 'sm' ? 26 : size === 'md' ? 28 : 30,
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0,
        background: 'var(--bg-app)',
        border: `1px solid ${invalid ? 'var(--c-red)' : focused ? 'color-mix(in srgb, var(--c-blue) 60%, transparent)' : 'var(--bd-3)'}`,
        borderRadius: 5,
        padding: '0 10px',
        color: 'var(--t1)',
        font: mono ? "12.5px var(--font-mono)" : '12.5px var(--font-ui)',
        outline: 'none',
        ...style
      }}
    />
  )
})

type AreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }

/** The multi-line field, same well and focus ring as TextInput. */
export const TextArea = forwardRef<HTMLTextAreaElement, AreaProps>(function TextArea({ mono, style, onFocus, onBlur, ...rest }, ref) {
  const [focused, setFocused] = useState(false)
  return (
    <textarea
      ref={ref}
      spellCheck={false}
      {...rest}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        resize: 'vertical',
        background: 'var(--bg-app)',
        border: `1px solid ${focused ? 'color-mix(in srgb, var(--c-blue) 60%, transparent)' : 'var(--bd-3)'}`,
        borderRadius: 5,
        padding: '7px 10px',
        color: 'var(--t1)',
        font: mono ? "12.5px/1.5 var(--font-mono)" : '12.5px/1.5 var(--font-ui)',
        outline: 'none',
        ...style
      }}
    />
  )
})

/** An on/off switch. */
export function Toggle({ on, disabled, onChange, title }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; title?: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => !disabled && onChange(!on)}
      style={{
        width: 28,
        height: 16,
        borderRadius: 8,
        background: on ? 'var(--c-green)' : 'var(--bd-4)',
        position: 'relative',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background .15s',
        flex: 'none'
      }}
    >
      <span style={{ position: 'absolute', top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: 'var(--t1)', transition: 'left .15s' }} />
    </button>
  )
}

/** A few mutually exclusive choices shown side by side (Edit | Preview). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  style
}: {
  value: T
  options: [T, React.ReactNode][]
  onChange: (v: T) => void
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 2, background: 'var(--bg-app)', border: '1px solid var(--bd-2)', borderRadius: 6, padding: 2, font: '12px var(--font-ui)', flex: 'none', ...style }}
    >
      {options.map(([v, label]) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === v}
          key={v}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(v)}
          style={{
            padding: '3px 10px',
            borderRadius: 4,
            background: value === v ? 'var(--bd-3)' : 'transparent',
            color: value === v ? 'var(--t1)' : 'var(--t3)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            font: 'inherit'
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
