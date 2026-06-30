import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

// Greater Sydney bounding box (roughly the ABS "Greater Sydney" GCCSA: from the
// Central Coast/Hawkesbury in the north down to the Royal National Park in the
// south, and out to the Blue Mountains in the west). Used to frame the initial
// view on the region and to decide which accounts count as inside it.
const GREATER_SYDNEY_BOUNDS = {
  south: -34.25,
  west: 150.2,
  north: -33.35,
  east: 151.4,
}

function inGreaterSydney(lat, lng) {
  return (
    lat >= GREATER_SYDNEY_BOUNDS.south &&
    lat <= GREATER_SYDNEY_BOUNDS.north &&
    lng >= GREATER_SYDNEY_BOUNDS.west &&
    lng <= GREATER_SYDNEY_BOUNDS.east
  )
}

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
// Overpass request and draw it as a yellow polyline. Returns the array of
// Polyline objects that were drawn (so callers can toggle them on/off later).
// Failures are logged and treated as "nothing drawn".
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
  if (!json) return []
  const polylines = []
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.geometry) continue
    const path = el.geometry.map((g) => ({ lat: g.lat, lng: g.lon }))
    polylines.push(
      new window.google.maps.Polyline({
        map,
        path,
        strokeColor: '#facc15',
        strokeOpacity: 1,
        strokeWeight: 5,
        zIndex: 1,
      })
    )
  }
  return polylines
}

// One labelled row inside a site card (label stacked above its value). Built
// with text nodes so account notes/builder names can't inject markup.
function cardRow(label, value) {
  const row = document.createElement('div')
  row.className = 'map-card-row'
  const tag = document.createElement('span')
  tag.className = 'map-card-label'
  tag.textContent = label
  row.appendChild(tag)
  row.appendChild(document.createTextNode(value || '—'))
  return row
}

// Build the HTML element for an active site's card: the CKO account details
// (USI, builder, notes) for its design request(s). When `onActivate` is given
// the whole card becomes a button that opens the account on the report page.
function buildCardEl({ usi, builder, notes, count, onActivate }) {
  const el = document.createElement('div')
  el.className = 'map-card'

  if (onActivate) {
    el.classList.add('map-card--clickable')
    el.setAttribute('role', 'button')
    el.tabIndex = 0
    el.title = `Open ${usi} in the accounts report`
    el.addEventListener('click', onActivate)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    })
  }

  const title = document.createElement('div')
  title.className = 'map-card-title'
  title.textContent = usi
  el.appendChild(title)

  const sub = document.createElement('div')
  sub.className = 'map-card-sub'
  sub.textContent = `${count} active design request${count === 1 ? '' : 's'}`
  el.appendChild(sub)

  el.appendChild(cardRow('Builder', builder))
  el.appendChild(cardRow('Notes', notes))
  return el
}

// Card geometry, in horizontal gap (px) the offset from a marker and the gap
// kept between stacked cards.
const CARD_OFFSET_X = 16
const CARD_GAP = 6

// Position every card beside its marker, then de-overlap: process cards top to
// bottom and, whenever one would cover a card already placed in the same
// horizontal band, push it straight down past it. Each card therefore stays
// fully readable even when its site sits right next to another.
function layoutCards(proj, items) {
  const boxes = items.map(({ el, position }) => {
    const p = proj.fromLatLngToDivPixel(position)
    const w = el.offsetWidth || 210
    const h = el.offsetHeight || 60
    return { el, anchorX: p.x, anchorY: p.y, w, h, left: p.x + CARD_OFFSET_X }
  })
  // Place cards nearest the top first so we only ever push later cards downward.
  boxes.sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX)

  const placed = []
  for (const box of boxes) {
    let top = box.anchorY - box.h / 2 // vertically centred on the marker
    let moved = true
    let guard = 0
    while (moved && guard++ < 200) {
      moved = false
      for (const p of placed) {
        const hOverlap = box.left < p.left + p.w && box.left + box.w > p.left
        if (!hOverlap) continue
        const vOverlap =
          top < p.top + p.h + CARD_GAP && top + box.h + CARD_GAP > p.top
        if (vOverlap) {
          top = p.top + p.h + CARD_GAP // drop below the card we collided with
          moved = true
        }
      }
    }
    box.top = top
    placed.push(box)
    box.el.style.left = `${box.left}px`
    box.el.style.top = `${top}px`
  }
}

// A single OverlayView that owns every site card. Holding them together lets the
// draw pass lay them all out at once and resolve overlaps; each card still
// tracks its marker because the layout re-runs on every map transform.
function createCardsLayer(map) {
  const items = [] // { el, position }
  const overlay = new window.google.maps.OverlayView()
  let pane = null

  overlay.onAdd = function () {
    pane = this.getPanes().floatPane
    for (const it of items) pane.appendChild(it.el)
  }
  overlay.draw = function () {
    const proj = this.getProjection()
    if (proj) layoutCards(proj, items)
  }
  overlay.onRemove = function () {
    for (const it of items) it.el.parentNode?.removeChild(it.el)
    pane = null
  }
  overlay.addCard = function (position, data) {
    const el = buildCardEl(data)
    el.style.position = 'absolute'
    items.push({ el, position })
    if (pane) pane.appendChild(el)
    const proj = this.getProjection()
    if (proj) layoutCards(proj, items)
  }

  overlay.setMap(map)
  return overlay
}

function fullAddress(account) {
  return [account.street_address, account.suburb, account.postcode]
    .filter(Boolean)
    .join(', ')
}

function MapPage() {
  const navigate = useNavigate()
  const mapRef = useRef(null)
  const [status, setStatus] = useState('Loading…')
  // Which markers to show: 'accounts' = every account, 'active' = only sites
  // with active design requests (the highlighted ones).
  const [view, setView] = useState('accounts')
  // Active requests/sites that couldn't be placed on the map, surfaced to the
  // user so the gaps are fixable. { noSite: [...], noAddress: [...], failed: [...] }
  const [unmapped, setUnmapped] = useState({
    noSite: [],
    noAddress: [],
    failed: [],
  })

  // The placed markers ({ marker, isHighlighted }), the active-street polylines,
  // and the map instance, kept across renders so the view buttons can toggle
  // visibility without re-geocoding everything.
  const markersRef = useRef([])
  const polylinesRef = useRef([])
  // Overlay layer holding the persistent info cards, one per active site. It
  // lays them out together so they never overlap and obscure one another.
  const cardsLayerRef = useRef(null)
  const mapInstanceRef = useRef(null)

  // Apply a view to the existing markers/polylines: in 'accounts' every marker
  // shows; in 'active' only highlighted sites (and their streets) show. When
  // `fit` is true (the default, used for user-driven view switches) the map is
  // re-framed to whatever is now visible; the initial load passes false so it
  // keeps the Greater Sydney framing set in init().
  function applyView(v, fit = true) {
    const map = mapInstanceRef.current
    if (!map) return
    const bounds = new window.google.maps.LatLngBounds()
    let visible = 0
    for (const { marker, isHighlighted } of markersRef.current) {
      const show = v === 'accounts' || isHighlighted
      marker.setVisible(show)
      if (show) {
        bounds.extend(marker.getPosition())
        visible++
      }
    }
    for (const line of polylinesRef.current) {
      line.setMap(v === 'active' ? map : null)
    }
    // Cards belong to active sites, which are visible in both views, so the
    // cards layer stays on the map regardless of the selected view.
    if (fit && visible > 0) map.fitBounds(bounds)
  }

  // Re-apply whenever the user switches views (markers may already exist).
  useEffect(() => {
    applyView(view)
  }, [view])

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
        .select(
          'id, usi, street_address, suburb, postcode, notes, builder:Companies!builder_id(Name)'
        )
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
      mapInstanceRef.current = map
      markersRef.current = []
      polylinesRef.current = []
      cardsLayerRef.current = createCardsLayer(map)
      const geocoder = new window.google.maps.Geocoder()
      // Collects only the accounts that fall inside Greater Sydney so the
      // initial view frames that region (and all its accounts), not far-flung
      // outliers that would otherwise zoom the map right out.
      const sydneyBounds = new window.google.maps.LatLngBounds()
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
                zIndex: isHighlighted ? 2 : 1,
              })
              markersRef.current.push({ marker, isHighlighted })
              // Active sites get a permanent card beside the marker with the
              // CKO account's builder and notes for its design request(s).
              if (isHighlighted) {
                cardsLayerRef.current?.addCard(position, {
                  usi: account.usi,
                  builder: account.builder?.Name,
                  notes: account.notes,
                  count: requestCount,
                  onActivate: () =>
                    navigate(`/accounts/report?account=${account.id}`),
                })
              }
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
              if (inGreaterSydney(position.lat(), position.lng())) {
                sydneyBounds.extend(position)
              }
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
      // Restrict the initial view to Greater Sydney: frame the accounts that
      // fall within the region, or the region box itself if none geocoded
      // there.
      if (!sydneyBounds.isEmpty()) {
        map.fitBounds(sydneyBounds)
      } else {
        map.fitBounds(
          new window.google.maps.LatLngBounds(
            { lat: GREATER_SYDNEY_BOUNDS.south, lng: GREATER_SYDNEY_BOUNDS.west },
            { lat: GREATER_SYDNEY_BOUNDS.north, lng: GREATER_SYDNEY_BOUNDS.east }
          )
        )
      }

      // Redraw the streets of active sites on top of the decluttered basemap.
      let streetsDrawn = 0
      if (activeStreets.length > 0) {
        polylinesRef.current = await drawActiveStreets(map, activeStreets)
        streetsDrawn = polylinesRef.current.length
      }
      if (cancelled) return

      // Honour the currently selected view now that all markers/streets exist,
      // but keep the Greater Sydney framing set above (fit = false).
      applyView(view, false)

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
          <div className="map-views" role="group" aria-label="Map view">
            <button
              type="button"
              className={`map-view-btn${
                view === 'accounts' ? ' map-view-btn--active' : ''
              }`}
              aria-pressed={view === 'accounts'}
              onClick={() => setView('accounts')}
            >
              All accounts
            </button>
            <button
              type="button"
              className={`map-view-btn${
                view === 'active' ? ' map-view-btn--active' : ''
              }`}
              aria-pressed={view === 'active'}
              onClick={() => setView('active')}
            >
              Active design requests
            </button>
          </div>
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
