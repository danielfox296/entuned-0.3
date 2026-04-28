import { useEffect, useState } from 'react'

// Hash format: #<group>/<sub>
function parse(): { group: string; sub: string } {
  const h = window.location.hash.replace(/^#/, '')
  if (!h) return { group: '', sub: '' }
  const idx = h.indexOf('/')
  if (idx === -1) return { group: decodeURIComponent(h), sub: '' }
  return {
    group: decodeURIComponent(h.slice(0, idx)),
    sub: decodeURIComponent(h.slice(idx + 1)),
  }
}

function write(group: string, sub: string) {
  const h = sub
    ? `${encodeURIComponent(group)}/${encodeURIComponent(sub)}`
    : encodeURIComponent(group)
  if (window.location.hash.replace(/^#/, '') !== h) {
    window.history.replaceState(null, '', `#${h}`)
  }
}

export function useNavGroup(defaultGroup: string): [string, (g: string) => void] {
  const [group, setGroup] = useState(() => parse().group || defaultGroup)
  useEffect(() => {
    const onChange = () => setGroup(parse().group || defaultGroup)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [defaultGroup])
  useEffect(() => {
    if (parse().group !== group) write(group, '')
  }, [group])
  return [group, (g) => { write(g, ''); setGroup(g) }]
}

export function useNavSub<T extends string = string>(
  defaultSub: T,
): [T, (s: T) => void] {
  const [sub, setSub] = useState<T>(() => (parse().sub as T) || defaultSub)
  useEffect(() => {
    const onChange = () => setSub((parse().sub as T) || defaultSub)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [defaultSub])
  return [sub, (s) => {
    write(parse().group, s)
    setSub(s)
  }]
}
