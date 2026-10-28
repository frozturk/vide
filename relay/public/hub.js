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
    const rename = document.createElement('button')
    rename.textContent = '✎'
    rename.title = 'Rename'
    rename.onclick = async () => {
      const next = prompt('Instance name (leave empty for the computer name)', name.textContent)
      if (next === null) return
      const res = await fetch(`/i/${id}/.relay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: next }) }).catch(() => null)
      if (res?.ok) return render()
      alert(res?.status === 401 ? 'Open this instance on this device first, then rename it.' : 'Renaming needs this vide to be online.')
    }
    const remove = document.createElement('button')
    remove.textContent = '×'
    remove.title = 'Remove'
    remove.onclick = () => {
      save(load().filter((x) => x !== id))
      render()
    }
    li.append(a, rename, remove)
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

function pairingLink(text) {
  try {
    const url = new URL(text.trim(), location.href)
    return url.origin === location.origin && /^\/i\/[\w-]+\/$/.test(url.pathname) ? url.href : null
  } catch {
    return null
  }
}

document.getElementById('add').addEventListener('submit', (e) => {
  e.preventDefault()
  const link = pairingLink(document.getElementById('link').value)
  if (link) location.href = link
})

const scanner = document.getElementById('scanner')
const video = document.getElementById('video')
const scanMsg = document.getElementById('scan-msg')
let stream = null

function stopScan() {
  for (const track of stream?.getTracks() ?? []) track.stop()
  stream = null
  video.srcObject = null
  scanner.hidden = true
}

async function startScan() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
  } catch {
    alert('vide needs camera access to scan the QR code.')
    return
  }
  scanMsg.textContent = 'Point at the QR code in vide → Settings → Web access'
  scanner.hidden = false
  video.srcObject = stream
  await video.play().catch(() => {})
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const tick = () => {
    if (!stream) return
    if (video.videoWidth) {
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })
      const link = code && pairingLink(code.data)
      if (link) {
        stopScan()
        location.href = link
        return
      }
      if (code) scanMsg.textContent = 'That QR code is not a pairing link for this relay.'
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

const scanButton = document.getElementById('scan')
scanButton.hidden = !navigator.mediaDevices?.getUserMedia
scanButton.addEventListener('click', () => void startScan())
document.getElementById('scan-cancel').addEventListener('click', stopScan)
addEventListener('pagehide', stopScan)

render()
addEventListener('pageshow', render)
