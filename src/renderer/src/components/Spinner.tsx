export function Spinner({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <span
      className="inline-block shrink-0 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300"
      style={{ width: size, height: size }}
    />
  )
}
