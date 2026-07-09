import { getIconForFilePath } from 'vscode-material-icons'

const modules = import.meta.glob(
  '../../../../node_modules/vscode-material-icons/generated/icons/*.svg',
  { eager: true, query: '?url', import: 'default' }
)

const ICON_URL: Record<string, string> = {}
for (const [path, url] of Object.entries(modules)) {
  ICON_URL[path.slice(path.lastIndexOf('/') + 1, -4)] = url as string
}

export function FileIcon({ path, size = 15 }: { path: string; size?: number }): React.JSX.Element {
  const name = path.toLowerCase().endsWith('.json') ? 'json' : getIconForFilePath(path)
  const url = ICON_URL[name] ?? ICON_URL.file
  return <img src={url} width={size} height={size} alt="" className="shrink-0" />
}
