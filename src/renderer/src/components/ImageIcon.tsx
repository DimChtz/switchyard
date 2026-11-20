import React from 'react'

/** A picture (a frame, a hill and the sun) - the formatting bar's image button. */
export function ImageIcon({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">
      <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.8" />
      <circle cx="5.6" cy="6.3" r="1.25" />
      <path d="M2.2 12.2 6.3 8.6l2.6 2.3 2.2-1.9 3 2.6" />
    </svg>
  )
}

/** A paperclip - the formatting bar's "attach a file" button. */
export function AttachIcon({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">
      <path d="M13.2 7.6 8.1 12.7a3.3 3.3 0 0 1-4.7-4.7l5.4-5.4a2.2 2.2 0 0 1 3.1 3.1L6.6 11a1.1 1.1 0 0 1-1.6-1.6l4.8-4.8" />
    </svg>
  )
}
