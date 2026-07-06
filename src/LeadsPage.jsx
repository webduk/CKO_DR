import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import supabase from './supabase-client'

// Accounts flagged as new leads (the "NEW LEAD" tick box on the Accounts page
// sets accounts.new_lead). We pull the builder company name via the same
// embedded-relation join the Accounts page uses.
const SELECT = '*, builder:Companies!builder_id(Name)'

function LeadsPage() {
  const [leads, setLeads] = useState([])
  const [search, setSearch] = useState('')

  async function fetchLeads() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('accounts')
      .select(SELECT)
      .eq('new_lead', true)
      .order('id', { ascending: true })
    if (error) {
      console.error('Error fetching leads:', error)
      return
    }
    setLeads(data ?? [])
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after await, not synchronously
    fetchLeads()
  }, [])

  // Free-form search across the columns shown in the table.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return leads
    return leads.filter((a) =>
      [a.usi, a.street_address, a.suburb, a.postcode, a.notes, a.builder?.Name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [leads, search])

  return (
    <main className="design-requests-page">
      <Link to="/" className="back-link">
        ← Back to home
      </Link>
      <h1>New Leads</h1>

      <div className="design-request-filters">
        <input
          type="search"
          className="design-request-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by USI, address, suburb or builder…"
        />
      </div>

      <div className="dr-table-card">
        <table className="design-request-table">
          <thead>
            <tr>
              <th>USI</th>
              <th>Street Address</th>
              <th>Suburb</th>
              <th>Postcode</th>
              <th>Builder</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td className="empty" colSpan={6}>
                  {search ? `No leads match “${search}”` : 'No new leads yet'}
                </td>
              </tr>
            )}
            {filtered.map((a) => (
              <tr key={a.id}>
                <td>{a.usi}</td>
                <td>{a.street_address ?? '—'}</td>
                <td>{a.suburb ?? '—'}</td>
                <td>{a.postcode ?? '—'}</td>
                <td>{a.builder?.Name ?? '—'}</td>
                <td className="dr-details">
                  <span className="dr-details-clamp" title={a.notes ?? ''}>
                    {a.notes ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

export default LeadsPage
