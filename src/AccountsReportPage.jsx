import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import './App.css'
import supabase from './supabase-client'

// The seven company roles on an account. `key` is the FK column on `accounts`;
// `alias` is the embedded-relation name we read back for display.
const ROLE_FIELDS = [
  { key: 'builder_id', alias: 'builder', label: 'Builder' },
  { key: 'pm_company_id', alias: 'pm_company', label: 'PM Company' },
  { key: 'developer_id', alias: 'developer', label: 'Developer' },
  { key: 'shoring_id', alias: 'shoring', label: 'Shoring' },
  { key: 'wd_id', alias: 'wd', label: 'WD' },
  { key: 'architect_id', alias: 'architect', label: 'Architect' },
  { key: 'consultants_id', alias: 'consultants', label: 'Consultants' },
]

// Pull each role company with enough detail to render its row and to join
// contacts / design requests back to it by id.
const ACCOUNT_SELECT = [
  '*',
  ...ROLE_FIELDS.map(
    (f) => `${f.alias}:Companies!${f.key}(id, Name, "Company Type")`,
  ),
].join(', ')

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// Earliest request date for an account as an ISO string (YYYY-MM-DD), or null
// when it has no active design requests.
function earliestRequestDate(account, requestsByAccount) {
  const reqs = requestsByAccount[account.id] ?? []
  if (reqs.length === 0) return null
  return reqs.reduce(
    (min, r) => (r.request_date < min ? r.request_date : min),
    reqs[0].request_date,
  )
}

// 'YYYY-MM' -> 'June 2026'
function monthLabel(key) {
  const [year, month] = key.split('-')
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`
}

function AccountsReportPage() {
  const [accounts, setAccounts] = useState([])
  const [contactsByCompany, setContactsByCompany] = useState({})
  const [requestsByAccount, setRequestsByAccount] = useState({})
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // When arriving from the map (…/accounts/report?account=<id>), this is the
  // account to auto-expand, scroll to, and highlight.
  const [searchParams] = useSearchParams()
  const targetAccountId = searchParams.get('account')

  async function loadReport() {
    if (!supabase) {
      setError('Not connected to Supabase.')
      setLoading(false)
      return
    }
    setLoading(true)
    const [accountsRes, contactsRes, requestsRes] = await Promise.all([
      supabase.from('accounts').select(ACCOUNT_SELECT).order('usi'),
      supabase.from('contacts').select('*').order('name'),
      supabase
        .from('design_requests')
        .select('*')
        .order('request_date', { ascending: false }),
    ])

    const firstError =
      accountsRes.error || contactsRes.error || requestsRes.error
    if (firstError) {
      console.error('Error loading report:', firstError)
      setError(firstError.message)
      setLoading(false)
      return
    }

    setAccounts(accountsRes.data ?? [])
    setContactsByCompany(groupBy(contactsRes.data ?? [], 'company_id'))
    // Design requests now belong to a specific account, so group them by
    // account_id — no more bleed across every account sharing a company.
    setRequestsByAccount(groupBy(requestsRes.data ?? [], 'account_id'))
    setError(null)
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after await, not synchronously
    loadReport()
  }, [])

  // Filter by account name (USI) and address, case-insensitive, then order the
  // page by each account's earliest active design request date (earliest at the
  // top). Accounts with no requests fall to the bottom in their original order.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = !q
      ? accounts
      : accounts.filter((a) =>
          [a.usi, a.street_address, a.suburb, a.postcode]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
    // ISO date strings (YYYY-MM-DD) sort correctly as plain strings.
    return [...matches].sort((a, b) => {
      const da = earliestRequestDate(a, requestsByAccount)
      const db = earliestRequestDate(b, requestsByAccount)
      if (da && db) return da < db ? -1 : da > db ? 1 : 0
      if (da) return -1
      if (db) return 1
      return 0
    })
  }, [accounts, query, requestsByAccount])

  // Group the (already date-sorted) accounts into month sections by the month of
  // their earliest active design request. Accounts with no requests fall into a
  // trailing "none" group that renders without a month bar.
  const monthGroups = useMemo(() => {
    const groups = []
    const indexByKey = new Map()
    for (const account of filtered) {
      const date = earliestRequestDate(account, requestsByAccount)
      const key = date ? date.slice(0, 7) : 'none'
      if (!indexByKey.has(key)) {
        indexByKey.set(key, groups.length)
        groups.push({
          key,
          label: key === 'none' ? null : monthLabel(key),
          accounts: [],
        })
      }
      groups[indexByKey.get(key)].accounts.push(account)
    }
    return groups
  }, [filtered, requestsByAccount])

  return (
    <main className="accounts-page report-page">
      <Link to="/" className="back-link">
        ← Back to home
      </Link>
      <h1>Accounts Report</h1>

      <input
        type="search"
        className="report-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by account name (USI) or address…"
      />

      {loading && <p className="report-status">Loading…</p>}
      {error && <p className="form-status error">{error}</p>}
      {!loading && !error && (
        <p className="report-status">
          {filtered.length} of {accounts.length} account
          {accounts.length === 1 ? '' : 's'}
        </p>
      )}

      {!loading &&
        !error &&
        monthGroups.map((group) => (
          <section key={group.key} className="report-month">
            {group.label && (
              <div className="report-month-bar">{group.label}</div>
            )}
            {group.accounts.map((account) => (
              <AccountReportCard
                key={account.id}
                account={account}
                contactsByCompany={contactsByCompany}
                requestsByAccount={requestsByAccount}
                isTarget={String(account.id) === targetAccountId}
              />
            ))}
          </section>
        ))}

      {!loading && !error && filtered.length === 0 && accounts.length > 0 && (
        <p className="report-status">No accounts match “{query}”.</p>
      )}
    </main>
  )
}

function AccountReportCard({
  account,
  contactsByCompany,
  requestsByAccount,
  isTarget,
}) {
  // Each card starts collapsed, showing only the header. The Expand button
  // reveals the companies, contacts, and design-request tables. A card linked
  // to from the map (isTarget) opens expanded.
  const [expanded, setExpanded] = useState(isTarget)
  const cardRef = useRef(null)

  // When this is the account linked from the map, bring it into view and flash
  // it so the user lands on the right record.
  useEffect(() => {
    if (isTarget && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isTarget])

  // The distinct companies attached to this account across all roles.
  const roleRows = ROLE_FIELDS.map((f) => ({
    label: f.label,
    company: account[f.alias],
  })).filter((r) => r.company)

  const companyIds = [...new Set(roleRows.map((r) => r.company.id))]
  const companyName = (id) =>
    roleRows.find((r) => r.company.id === id)?.company.Name ?? '—'

  const contacts = companyIds.flatMap((id) =>
    (contactsByCompany[id] ?? []).map((c) => ({
      ...c,
      companyName: companyName(id),
    })),
  )
  // Requests are linked straight to this account now, so look them up by the
  // account id rather than through its companies. Show them earliest date first.
  const requests = [...(requestsByAccount[account.id] ?? [])].sort((a, b) =>
    a.request_date < b.request_date
      ? -1
      : a.request_date > b.request_date
        ? 1
        : 0,
  )

  const address = [account.street_address, account.suburb, account.postcode]
    .filter(Boolean)
    .join(', ')

  return (
    <section
      ref={cardRef}
      className={`report-card${isTarget ? ' report-card--target' : ''}`}
    >
      <header className="report-card-header">
        <h2>{account.usi}</h2>
        {address && <span className="report-address">{address}</span>}
        <button
          type="button"
          className="report-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </header>

      {expanded && (
        <>
          <h3>Companies</h3>
          <table className="account-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Company</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {roleRows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={3}>
                    No companies linked
                  </td>
                </tr>
              )}
              {roleRows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{r.company.Name}</td>
                  <td>{r.company['Company Type'] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Contacts</h3>
          <table className="account-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Name</th>
                <th>Title</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 && (
                <tr>
                  <td className="empty" colSpan={5}>
                    No contacts
                  </td>
                </tr>
              )}
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.companyName}</td>
                  <td>{c.name}</td>
                  <td>{c.title ?? '—'}</td>
                  <td>{c.email ?? '—'}</td>
                  <td>{c.phone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {requests.length > 0 && (
            <>
              <h3>Active Design Requests</h3>
              <table className="account-table">
                <thead>
                  <tr>
                    <th>Requestor</th>
                    <th>Date</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="active-request-row">
                      <td>{r.requestor_name}</td>
                      <td>{r.request_date}</td>
                      <td className="report-details">{r.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  )
}

function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    const k = row[key]
    ;(acc[k] ??= []).push(row)
    return acc
  }, {})
}

export default AccountsReportPage
