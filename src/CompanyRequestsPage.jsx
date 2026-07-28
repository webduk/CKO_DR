import { useState, useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import './App.css'
import supabase from './supabase-client'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'closed', label: 'Closed' },
]
const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s.label]))

const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'mid', label: 'Mid' },
  { value: 'low', label: 'Low' },
]
const PRIORITY_LABELS = Object.fromEntries(PRIORITY_OPTIONS.map((p) => [p.value, p.label]))

// The three widget companies keyed by their boolean column on design_requests —
// this is the :company URL param the home-page widgets link to. Any other value
// is treated as unknown and the page shows a not-found message.
const COMPANIES = {
  arw: { label: 'ARW' },
  meso: { label: 'MESO' },
  wpa: { label: 'WPA' },
}

const SELECT = '*, request_type:request_types(name)'

// "16 Jun 2026" from an ISO date string, parsed off the string to avoid a
// timezone shift rolling the day backwards.
function formatDate(dateStr) {
  const [year, month, day] = (dateStr ?? '').split('-')
  const idx = Number(month) - 1
  if (!year || !day || idx < 0 || idx > 11) return dateStr ?? '—'
  return `${Number(day)} ${MONTH_NAMES[idx].slice(0, 3)} ${year}`
}

// A per-company summary of its design requests, reached by clicking the ARW /
// MESO / WPA widget on the home page. Read-only: rows are still created, edited
// and closed from the home page and the All Design Requests archive.
function CompanyRequestsPage() {
  const { company } = useParams()
  const meta = COMPANIES[company]
  const [designRequests, setDesignRequests] = useState([])

  async function fetchDesignRequests() {
    if (!supabase || !meta) return
    const { data, error } = await supabase
      .from('design_requests')
      .select(SELECT)
      .eq(company, true)
      .order('request_date', { ascending: false })
    if (error) {
      console.error('Error fetching company design requests:', error)
      return
    }
    setDesignRequests(data ?? [])
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after await, not synchronously
    fetchDesignRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch whenever the :company param changes; fetchDesignRequests is stable
  }, [company])

  // Headline tallies for the summary tiles: total, open (active + on-hold),
  // closed, and how many of the open ones are critical.
  const stats = useMemo(() => {
    const open = designRequests.filter((r) => r.status !== 'closed')
    return {
      total: designRequests.length,
      open: open.length,
      closed: designRequests.filter((r) => r.status === 'closed').length,
      critical: open.filter((r) => r.priority === 'critical').length,
    }
  }, [designRequests])

  if (!meta) {
    return (
      <main className="design-requests-page">
        <Link to="/" className="back-link">
          ← Back to home
        </Link>
        <h1>Unknown company</h1>
        <p className="page-intro">
          “{company}” is not a recognised company. Choose ARW, MESO or WPA from
          the home page.
        </p>
      </main>
    )
  }

  return (
    <main className="design-requests-page">
      <Link to="/" className="back-link">
        ← Back to home
      </Link>
      <h1>{meta.label} Design Requests</h1>
      <p className="page-intro">
        Every design request tagged {meta.label}, including closed ones. Requests
        are created, edited and closed from the home page.
      </p>

      <div className="report-widgets">
        <div className={`stat-widget report-widget report-widget--${company}`}>
          <span className="stat-number">{stats.open}</span>
          <span className="stat-label">Open</span>
        </div>
        <div className="stat-widget report-widget">
          <span className="stat-number">{stats.critical}</span>
          <span className="stat-label">Critical (open)</span>
        </div>
        <div className="stat-widget report-widget">
          <span className="stat-number">{stats.closed}</span>
          <span className="stat-label">Closed</span>
        </div>
        <div className="stat-widget report-widget">
          <span className="stat-number">{stats.total}</span>
          <span className="stat-label">Total</span>
        </div>
      </div>

      <div className="dr-table-card">
        <table className="design-request-table">
          <thead>
            <tr>
              <th>Priority</th>
              <th>Request Type</th>
              <th>Requestor</th>
              <th>Date</th>
              <th>Details</th>
              <th>Status</th>
              <th>Closed On</th>
            </tr>
          </thead>
          <tbody>
            {designRequests.length === 0 && (
              <tr>
                <td className="empty" colSpan={7}>
                  No design requests tagged {meta.label} yet
                </td>
              </tr>
            )}
            {designRequests.map((r) => (
              <tr key={r.id}>
                <td>
                  <span
                    className={`status-badge priority-badge priority-badge--${r.priority ?? 'mid'}`}
                  >
                    {PRIORITY_LABELS[r.priority] ?? r.priority ?? '—'}
                  </span>
                </td>
                <td>
                  {r.request_type?.name ? (
                    <span className="type-badge">{r.request_type.name}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="dr-requestor">{r.requestor_name ?? '—'}</td>
                <td className="dr-date">{formatDate(r.request_date)}</td>
                <td className="dr-details">
                  <span className="dr-details-clamp" title={r.details}>
                    {r.details}
                  </span>
                </td>
                <td>
                  <span className={`status-badge status-badge--${r.status}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </td>
                <td className="dr-date">
                  {r.closed_at ? formatDate(r.closed_at) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

export default CompanyRequestsPage
