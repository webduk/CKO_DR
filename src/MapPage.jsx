import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import supabase from './supabase-client'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// Declutter the basemap so major thoroughfares dominate: minor/local streets
// are kept but drawn very thin and muted (labels off), while highways and
// arterials render at full weight. Active design-request sites are pinpointed
// by their yellow markers + USI labels and their street is redrawn in yellow.
const MAP_STYLES = [
  {
    featureType: 'road.local',
    elementType: 'geometry',
    stylers: [{ weight: 0.5 }, { color: '#e9e9e9' }],
  },
  {
    featureType: 'road.local',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  // Strip Google's default points of interest (businesses, attractions, etc.)
  // and transit stops so only our sites and the road network remain.
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

// Load the Google Maps JS API once and resolve when ready.
let mapsLoaderPromise = null
function loadGoogleMaps() {
  if (window.google?.maps) return Promise.resolve()
  if (mapsLoaderPromise) return mapsLoaderPromise
  mapsLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`
    script.async = true
    script.onload = resolve
    script.onerror = () => reject(new Error('Failed to load Google Maps'))
    document.head.appendChild(script)
  })
  return mapsLoaderPromise
}

// Since the basemap hides local roads, we redraw the actual street each active
// site sits on. Google's APIs don't return a road's full polyline, so we pull
// the real geometry from OpenStreetMap's Overpass API (keyless, CORS-enabled).
// Overpass mirrors, tried in order; all send permissive CORS headers.
const OVERPASS_URLS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

// Run an Overpass query against the mirrors in turn, returning the parsed JSON
// from the first one that succeeds (or null if they all fail).
async function runOverpass(query) {
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      console.warn(`Overpass mirror ${url} failed: ${e.message}`)
    }
  }
  return null
}

// Given the active sites ({ name, lat, lng }), fetch each road's geometry in one
// Overpass request and draw it as a yellow polyline. Returns how many segments
// were drawn. Failures are logged and treated as "nothing drawn".
async function drawActiveStreets(map, streets) {
  // One union query: named highway ways within ~300 m of each site.
  const clauses = streets
    .map(
      (s) =>
        `way(around:300,${s.lat},${s.lng})["highway"]["name"=${JSON.stringify(
          s.name
        )}];`
    )
    .join('')
  const query = `[out:json][timeout:25];(${clauses});out geom;`
  const json = await runOverpass(query)
  if (!json) return 0
  let drawn = 0
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.geometry) continue
    const path = el.geometry.map((g) => ({ lat: g.lat, lng: g.lon }))
    new window.google.maps.Polyline({
      map,
      path,
      strokeColor: '#facc15',
      strokeOpacity: 1,
      strokeWeight: 5,
      zIndex: 1,
    })
    drawn += 1
  }
  return drawn
}

function fullAddress(account) {
  return [account.street_address, account.suburb, account.postcode]
    .filter(Boolean)
    .join(', ')
}

function MapPage() {
  const mapRef = useRef(null)
  const [status, setStatus] = useState('Loading…')
  // Active requests/sites that couldn't be placed on the map, surfaced to the
  // user so the gaps are fixable. { noSite: [...], noAddress: [...], failed: [...] }
  const [unmapped, setUnmapped] = useState({
    noSite: [],
    noAddress: [],
    failed: [],
  })

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!GOOGLE_MAPS_API_KEY) {
        setStatus('missing-key')
        return
      }
      if (!supabase) {
        setStatus('Not connected to Supabase.')
        return
      }

      const { data, error } = await supabase
        .from('accounts')
        .select('id, usi, street_address, suburb, postcode')
      if (error) {
        setStatus(`Error loading accounts: ${error.message}`)
        return
      }

      // All ACTIVE design requests, with enough detail to identify any that
      // can't be placed. We count how many map onto a site (account) so those
      // markers can be highlighted, and collect the ones with no site linked so
      // they can be flagged to the user instead of silently dropped.
      const { data: requestRows, error: requestErr } = await supabase
        .from('design_requests')
        .select('id, requestor_name, request_date, account_id')
        .eq('status', 'active')
        .order('id', { ascending: true })
      if (requestErr) {
        setStatus(`Error loading design requests: ${requestErr.message}`)
        return
      }
      const activeTotal = (requestRows ?? []).length
      const requestCountByAccount = new Map()
      const noSiteRequests = []
      for (const row of requestRows ?? []) {
        if (row.account_id == null) {
          noSiteRequests.push(row)
          continue
        }
        requestCountByAccount.set(
          row.account_id,
          (requestCountByAccount.get(row.account_id) ?? 0) + 1
        )
      }
      // Accounts that have active requests but lack a usable address — they have
      // a site linked, but nothing to geocode, so they also won't appear.
      const accountsById = new Map((data ?? []).map((a) => [a.id, a]))
      const noAddressAccounts = [...requestCountByAccount.keys()]
        .filter((id) => !fullAddress(accountsById.get(id) ?? {}))
        .map((id) => ({
          id,
          usi: accountsById.get(id)?.usi ?? `account #${id}`,
          count: requestCountByAccount.get(id),
        }))

      const accounts = (data ?? []).filter((a) => fullAddress(a))
      if (accounts.length === 0) {
        setStatus('No accounts have address data yet.')
        return
      }

      try {
        await loadGoogleMaps()
      } catch (e) {
        setStatus(e.message)
        return
      }
      if (cancelled) return

      const map = new window.google.maps.Map(mapRef.current, {
        center: { lat: -33.8688, lng: 151.2093 }, // Sydney default
        zoom: 5,
        styles: MAP_STYLES,
      })
      const geocoder = new window.google.maps.Geocoder()
      const bounds = new window.google.maps.LatLngBounds()
      const info = new window.google.maps.InfoWindow()
      // A bright, larger dot marks accounts that have design requests so they
      // stand out from the muted default markers.
      const highlightIcon = {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: '#facc15',
        fillOpacity: 1,
        strokeColor: '#000000',
        strokeWeight: 2,
      }
      let placed = 0
      let failed = 0
      let highlighted = 0
      // Count of active requests that actually rendered on the map (sum of
      // per-account request counts for the sites we successfully placed).
      let activeMapped = 0
      // Active sites whose street we'll redraw from OSM after geocoding.
      const activeStreets = []
      // Sites with active requests that have an address but failed to geocode.
      const failedSites = []

      for (const account of accounts) {
        const address = fullAddress(account)
        const requestCount = requestCountByAccount.get(account.id) ?? 0
        const isHighlighted = requestCount > 0
        await new Promise((resolve) => {
          geocoder.geocode({ address }, (results, gStatus) => {
            if (gStatus === 'OK' && results[0]) {
              const position = results[0].geometry.location
              const marker = new window.google.maps.Marker({
                map,
                position,
                title: account.usi,
                icon: isHighlighted ? highlightIcon : undefined,
                // Active sites show their USI as a permanent label beside the
                // dot; the class shifts the text to the right of the marker.
                label: isHighlighted
                  ? {
                      text: account.usi,
                      className: 'map-usi-label',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: '#1f2937',
                    }
                  : undefined,
                zIndex: isHighlighted ? 2 : 1,
              })
              marker.addListener('click', () => {
                const requestLine = isHighlighted
                  ? `<br/><span style="color:#b45309">${requestCount} active design request${
                      requestCount === 1 ? '' : 's'
                    }</span>`
                  : ''
                info.setContent(
                  `<strong>${account.usi}</strong><br/>${address}${requestLine}`
                )
                info.open(map, marker)
              })
              bounds.extend(position)
              placed++
              if (isHighlighted) {
                highlighted++
                activeMapped += requestCount
                // Capture the street (route) name so we can redraw it from OSM.
                const route = results[0].address_components?.find((c) =>
                  c.types.includes('route')
                )
                if (route?.long_name) {
                  activeStreets.push({
                    name: route.long_name,
                    lat: position.lat(),
                    lng: position.lng(),
                  })
                }
              }
            } else {
              failed++
              if (isHighlighted) {
                failedSites.push({ usi: account.usi, address, count: requestCount })
              }
              console.warn(`Geocode failed for "${address}": ${gStatus}`)
            }
            resolve()
          })
        })
      }

      if (cancelled) return
      if (placed > 0) map.fitBounds(bounds)

      // Redraw the streets of active sites on top of the decluttered basemap.
      let streetsDrawn = 0
      if (activeStreets.length > 0) {
        streetsDrawn = await drawActiveStreets(map, activeStreets)
      }
      if (cancelled) return

      // Active requests that never reached the map: those with no site linked,
      // plus any whose site lacks/failed to geocode an address.
      const activeUnmapped = activeTotal - activeMapped
      setUnmapped({
        noSite: noSiteRequests,
        noAddress: noAddressAccounts,
        failed: failedSites,
      })
      setStatus(
        `Mapped ${placed} account${placed === 1 ? '' : 's'}` +
          (highlighted
            ? ` · ${activeMapped} active design request${
                activeMapped === 1 ? '' : 's'
              } across ${highlighted} site${highlighted === 1 ? '' : 's'}`
            : '') +
          (streetsDrawn
            ? ` · ${streetsDrawn} active street${
                streetsDrawn === 1 ? '' : 's'
              } highlighted`
            : '') +
          (activeUnmapped > 0
            ? ` · ${activeUnmapped} active request${
                activeUnmapped === 1 ? '' : 's'
              } not shown (see below)`
            : '') +
          (failed ? ` · ${failed} address(es) could not be located` : '')
      )
    }

    init()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="map-page">
      <Link to="/" className="back-link">
        ← Back to home
      </Link>
      <h1>Account Locations</h1>

      {status === 'missing-key' ? (
        <div className="map-notice">
          <p>
            Google Maps API key is not configured. Add{' '}
            <code>VITE_GOOGLE_MAPS_API_KEY</code> to your <code>.env</code> file
            and restart the dev server.
          </p>
        </div>
      ) : (
        <>
          <p className="map-status">{status}</p>
          <p className="map-legend">
            <span className="map-legend-dot map-legend-dot--active" />
            Active design requests
          </p>
          {(unmapped.noSite.length > 0 ||
            unmapped.noAddress.length > 0 ||
            unmapped.failed.length > 0) && (
            <div className="map-unmapped">
              <strong>
                Some active design requests aren’t on the map — fix the data to
                show them:
              </strong>
              {unmapped.noSite.length > 0 && (
                <div className="map-unmapped-group">
                  <span className="map-unmapped-heading">
                    No site (account) linked — assign a site on the Design
                    Requests page:
                  </span>
                  <ul>
                    {unmapped.noSite.map((r) => (
                      <li key={r.id}>
                        Request #{r.id}
                        {r.requestor_name ? ` — ${r.requestor_name}` : ''}
                        {r.request_date ? ` (${r.request_date})` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {unmapped.noAddress.length > 0 && (
                <div className="map-unmapped-group">
                  <span className="map-unmapped-heading">
                    Site has no address — add street/suburb/postcode to the
                    account:
                  </span>
                  <ul>
                    {unmapped.noAddress.map((a) => (
                      <li key={a.id}>
                        {a.usi} ({a.count} active request
                        {a.count === 1 ? '' : 's'})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {unmapped.failed.length > 0 && (
                <div className="map-unmapped-group">
                  <span className="map-unmapped-heading">
                    Address couldn’t be located — check it’s correct:
                  </span>
                  <ul>
                    {unmapped.failed.map((a, i) => (
                      <li key={`${a.usi}-${i}`}>
                        {a.usi} — {a.address}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <div ref={mapRef} className="map-canvas" />
        </>
      )}
    </main>
  )
}

export default MapPage
