try {
  const id = location.pathname.split('/')[2]
  const list = JSON.parse(localStorage.getItem('vide.instances') || '[]')
  if (id && !list.includes(id)) localStorage.setItem('vide.instances', JSON.stringify([...list, id]))
} catch {}
