import { themeIcons } from 'seti-icons'

const getIcon = themeIcons({
  blue: '#519aba',
  grey: '#4d5a5e',
  'grey-light': '#6d8086',
  green: '#8dc149',
  orange: '#e37933',
  pink: '#f55385',
  purple: '#a074c4',
  red: '#cc3e44',
  white: '#d4d7d6',
  yellow: '#cbcb41',
  ignore: '#41535b'
})

export function FileIcon({ path, size = 20 }: { path: string; size?: number }): React.JSX.Element {
  const name = path.replace(/\/+$/, '').split('/').pop() ?? path
  const { svg, color } = getIcon(name)
  const fill = /\.(test|spec)\.tsx?$/i.test(name) ? '#e37933' : color
  const html = svg.replace('<svg ', `<svg width="${size}" height="${size}" fill="${fill}" `)
  return <span className="shrink-0" dangerouslySetInnerHTML={{ __html: html }} />
}
