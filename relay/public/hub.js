const KEY = 'vide.instances'

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {}
}

function render() {
  const list = load()
  const ul = document.getElementById('list')
  ul.replaceChildren()
  document.getElementById('empty').hidden = list.length > 0
  for (const id of list) {
    const li = document.createElement('li')
    const a = document.createElement('a')
    a.href = `/i/${id}/`
    const dot = document.createElement('span')
    dot.className = 'dot'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = id
    a.append(dot, name)
    const remove = document.createElement('button')
    remove.textContent = '×'
    remove.title = 'Remove'
    remove.onclick = () => {
      save(load().filter((x) => x !== id))
      render()
    }
    li.append(a, remove)
    ul.append(li)
    fetch(`/i/${id}/.relay`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((info) => {
        if (info.name) name.textContent = info.name
        dot.classList.toggle('on', info.online)
      })
      .catch(() => {})
  }
}

document.getElementById('add').addEventListener('submit', (e) => {
  e.preventDefault()
  try {
    const url = new URL(document.getElementById('link').value.trim(), location.href)
    if (url.origin === location.origin && /^\/i\/[\w-]+\/$/.test(url.pathname)) location.href = url.href
  } catch {}
})

render()
addEventListener('pageshow', render)
