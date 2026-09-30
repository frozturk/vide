import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

export function QrCode({ value, size = 168 }: { value: string; size?: number }): React.JSX.Element {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { path: d, count: n }
  }, [value])
  return (
    <svg width={size} height={size} viewBox={`-3 -3 ${count + 6} ${count + 6}`} shapeRendering="crispEdges" className="rounded-xl bg-white" role="img" aria-label="QR code for the web access link">
      <path d={path} fill="#09090b" />
    </svg>
  )
}
