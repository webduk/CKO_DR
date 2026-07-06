import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
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

const SELECT = '*, request_type:request_types(name)'

// "16 Jun 2026" from an ISO date string, parsed off the string to avoid a
// timezone shift rolling the day backwards.
function formatDate(dateStr) {
  const [year, month, day] = (dateStr ?? '').split('-')
  const idx = Number(month) - 1
  if (!year || !day || idx < 0 || idx > 11) return dateStr ?? '—'
  return `${Number(day)} ${MONTH_NAMES[idx].slice(0, 3)} ${year}`
}

// The dedicated, read-only archive of EVERY design request — including closed
// ones, which are hidden from the home-page summary. Editing and closing still
// happen on the home page; this page is the complete reference table.
function DesignRequestsAllPage() {
  const [designRequests, setDesignRequests] = useState([])
  const [query, setQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  async function fetchDesignRequests() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('design_requests')
      .select(SELECT)
      .order('request_date', { ascending: false })
    if (error) {
      console.error('Error fetching design requests:', error)
      return
    }
    setDesignRequests(data ?? [])
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after await, not synchronously
    fetchDesignRequests()
  }, [])

  const filtered = useMemo(() => {
    let rows = designRequests
    if (priorityFilter !== 'all') {
      rows = rows.filter((r) => (r.priority ?? 'mid') === priorityFilter)
    }
    if (statusFilter !== 'all') {
      rows = rows.filter((r) => r.status === statusFilter)
    }
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.request_type?.name, r.requestor_name, r.details, r.request_date, r.status, r.priority]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [designRequests, query, priorityFilter, statusFilter])

  return (
    <main className="design-requests-page">
      <Link to="/" className="back-link">
        ← Back to home
      </Link>
      <h1>All Design Requests</h1>
      <p className="page-intro">
        Every design request, including closed ones. Requests are created,
        edited and closed from the home page.
      </p>

      <div className="design-request-filters">
        <input
          type="search"
          className="design-request-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by requestor, request type or details…"
        />
        <select
          className="design-request-filter"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="all">All priorities</option>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className="design-request-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
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
            {filtered.length === 0 && (
              <tr>
                <td className="empty" colSpan={7}>
                  {query || priorityFilter !== 'all' || statusFilter !== 'all'
                    ? 'No design requests match the current filters'
                    : 'No design requests yet'}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
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

export default DesignRequestsAllPage
