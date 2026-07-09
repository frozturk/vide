import { useCallback, useEffect, useState } from 'react'

export function useHSplit(
  key: string,
  def: number,
  min: number,
  max: number
): [number, (v: number) => void] {
  const clamp = (v: number): number => Math.min(max, Math.max(min, v))
  const [frac, setFracState] = useState(() => {
    const v = parseFloat(localStorage.getItem(key) ?? '')
    return Number.isFinite(v) ? clamp(v) : def
  })
  useEffect(() => {
    localStorage.setItem(key, String(frac))
  }, [key, frac])
  const setFrac = useCallback((v: number) => setFracState(clamp(v)), [min, max])
  return [frac, setFrac]
}

interface ResizerProps {
  onDrag: (clientX: number) => void
  onStart?: () => void
  onEnd?: () => void
  style?: React.CSSProperties
}

export function Resizer({ onDrag, onStart, onEnd, style }: ResizerProps): React.JSX.Element {
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      onStart?.()
      document.body.style.cursor = 'col-resize'
      const move = (ev: PointerEvent): void => onDrag(ev.clientX)
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.style.cursor = ''
        onEnd?.()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [onDrag, onStart, onEnd]
  )

  return (
    <div
      onPointerDown={onPointerDown}
      className="z-50 cursor-col-resize"
      style={{ WebkitAppRegion: 'no-drag', ...style } as React.CSSProperties}
    />
  )
}
