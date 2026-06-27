import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import supabase from './supabase-client'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

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

function fullAddress(account) {
  return [account.street_address, account.suburb, account.postcode]
    .filter(Boolean)
    .join(', ')
}

function MapPage() {
  const mapRef = useRef(null)
  const [status, setStatus] = useState('Loading…')

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
      })
      const geocoder = new window.google.maps.Geocoder()
      const bounds = new window.google.maps.LatLngBounds()
      const info = new window.google.maps.InfoWindow()
      let placed = 0
      let failed = 0

      for (const account of accounts) {
        const address = fullAddress(account)
        await new Promise((resolve) => {
          geocoder.geocode({ address }, (results, gStatus) => {
            if (gStatus === 'OK' && results[0]) {
              const position = results[0].geometry.location
              const marker = new window.google.maps.Marker({
                map,
                position,
                title: account.usi,
              })
              marker.addListener('click', () => {
                info.setContent(
                  `<strong>${account.usi}</strong><br/>${address}`
                )
                info.open(map, marker)
              })
              bounds.extend(position)
              placed++
            } else {
              failed++
              console.warn(`Geocode failed for "${address}": ${gStatus}`)
            }
            resolve()
          })
        })
      }

      if (cancelled) return
      if (placed > 0) map.fitBounds(bounds)
      setStatus(
        `Mapped ${placed} account${placed === 1 ? '' : 's'}` +
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
          <div ref={mapRef} className="map-canvas" />
        </>
      )}
    </main>
  )
}

export default MapPage
