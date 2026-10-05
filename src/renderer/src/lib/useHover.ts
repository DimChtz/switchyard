import { useState, useCallback } from 'react'

export function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [hover, setHover] = useState(false)
  const onMouseEnter = useCallback(() => setHover(true), [])
  const onMouseLeave = useCallback(() => setHover(false), [])
  return [hover, { onMouseEnter, onMouseLeave }]
}
