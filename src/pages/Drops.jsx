// q77: карта дропов — Leaflet по OSM-тайлам. Дропы тянутся через
// get_profile (per-profile деталка) и геокодируются по address/city/zip
// через Nominatim; кеш в localStorage (без повторных запросов между
// сессиями). Клик по маркеру — popup с данными дропа.
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useLang } from '../hooks/useLang'
import 'leaflet/dist/leaflet.css'

const GEO_CACHE_KEY = 'vb-drop-geo-cache-v1'
const GEO_TIMEOUT_MS = 4000
const GEO_USER_AGENT = 'VaultBase/1.0 (drop-map)'

function loadGeoCache() {
  try {
    return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveGeoCache(cache) {
  try {
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* quota */
  }
}

function normalizeAddress({ address, city, state, zip, country }) {
  return [address, city, state, zip, country].filter(Boolean).join(', ').trim().toLowerCase()
}

async function geocode(query) {
  if (!query) return null
  const cache = loadGeoCache()
  if (cache[query]) return cache[query]
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '1')
  url.searchParams.set('addressdetails', '0')
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
      headers: { 'User-Agent': GEO_USER_AGENT },
    })
    if (!resp.ok) return null
    const json = await resp.json()
    const hit = json?.[0]
    if (!hit) return null
    const point = { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon) }
    cache[query] = point
    saveGeoCache(cache)
    return point
  } catch {
    return null
  }
}

export default function Drops() {
  const { t } = useLang()
  const mapEl = useRef(null)
  const [loading, setLoading] = useState(true)
  const [geoProgress, setGeoProgress] = useState({ done: 0, total: 0 })

  useEffect(() => {
    let cancelled = false
    let leafletMap = null

    async function load() {
      try {
        const profs = await invoke('get_profiles', {
          filter: {},
          page: 1,
          perPage: 200,
        })
        const profiles = profs?.items || []
        const details = await Promise.allSettled(
          profiles.map(p => invoke('get_profile', { id: p.id }))
        )
        const all = []
        for (const d of details) {
          if (d.status === 'fulfilled') {
            for (const drop of d.value?.drops || []) {
              all.push({ ...drop, profile_name: d.value.profile.name })
            }
          }
        }
        if (cancelled) return
        setGeoProgress({ done: 0, total: all.length })
        const pts = []
        for (const drop of all) {
          const q = normalizeAddress(drop)
          const point = await geocode(q)
          if (point) pts.push({ ...drop, ...point })
          if (cancelled) return
          setGeoProgress(g => ({ ...g, done: g.done + 1 }))
          await new Promise(r => setTimeout(r, 1100))
        }
        if (cancelled) return
        const L = (await import('leaflet')).default
        if (!mapEl.current) return
        leafletMap = L.map(mapEl.current).setView([39.8283, -98.5795], 4)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
          maxZoom: 19,
        }).addTo(leafletMap)
        const markers = []
        for (const p of pts) {
          const m = L.marker([p.lat, p.lon]).addTo(leafletMap)
          m.bindPopup(
            `<b>${p.recipient_name || p.profile_name}</b><br>` +
              `${p.address}<br>${p.city}, ${p.state || ''} ${p.zip}` +
              (p.is_primary ? '<br><em>primary</em>' : '')
          )
          markers.push(m)
        }
        if (markers.length > 0) {
          leafletMap.fitBounds(L.featureGroup(markers).getBounds().pad(0.2))
        }
      } catch {
        // страница просто покажет пустую карту
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
      leafletMap?.remove()
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 120px)' }}>
      <div
        ref={mapEl}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 12,
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      />
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 500,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
            color: 'var(--text-2)',
          }}
        >
          {t('drops_loading', { done: geoProgress.done, total: geoProgress.total })}
        </div>
      )}
    </div>
  )
}
