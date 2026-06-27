import { useState, useEffect, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import supabase from './supabase-client'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Derive a "June 2026" label from an ISO date string ("2026-06-20"). We read the
// year/month off the string directly rather than via `new Date()` to avoid the
// timezone shift that can roll a date back into the previous month.
function monthLabel(dateStr) {
  const [year, month] = (dateStr ?? '').split('-')
  const idx = Number(month) - 1
  if (!year || idx < 0 || idx > 11) return 'No date'
  return `${MONTH_NAMES[idx]} ${year}`
}

function DesignRequestsPage() {
  const [accounts, setAccounts] = useState([])
  const [requestTypes, setRequestTypes] = useState([])
  const [designRequests, setDesignRequests] = useState([])
  const [reqAccountId, setReqAccountId] = useState('')
  const [reqTypeId, setReqTypeId] = useState('')
  const [reqName, setReqName] = useState('')
  const [reqDate, setReqDate] = useState('')
  const [reqDetails, setReqDetails] = useState('')
  const [reqStatus, setReqStatus] = useState(null)
  const [query, setQuery] = useState('')
  // `editReqId` is the design request row currently in edit mode (null = none);
  // `editReq` holds its in-progress values until saved or cancelled.
  const [editReqId, setEditReqId] = useState(null)
  const [editReq, setEditReq] = useState({
    account_id: '',
    request_type_id: '',
    requestor_name: '',
    request_date: '',
    details: '',
  })
  // Inline management of the Request Type option list (add/rename/delete).
  const [newTypeName, setNewTypeName] = useState('')
  const [typeStatus, setTypeStatus] = useState(null)
  const [editingTypeId, setEditingTypeId] = useState(null)
  const [editingTypeName, setEditingTypeName] = useState('')

  useEffect(() => {
    fetchAccounts()
    fetchRequestTypes()
    fetchDesignRequests()
  }, [])

  async function fetchAccounts() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('accounts')
      .select('id, usi')
      .order('usi', { ascending: true })
    if (error) {
      console.error('Error fetching accounts:', error)
      return
    }
    setAccounts(data ?? [])
  }

  async function fetchRequestTypes() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('request_types')
      .select('id, name')
      .order('name', { ascending: true })
    if (error) {
      console.error('Error fetching request types:', error)
      return
    }
    setRequestTypes(data ?? [])
  }

  async function fetchDesignRequests() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('design_requests')
      .select('*, accounts(usi), request_type:request_types(name)')
      .order('id', { ascending: true })
    if (error) {
      console.error('Error fetching design requests:', error)
      return
    }
    setDesignRequests(data ?? [])
  }

  async function addDesignRequest(e) {
    e.preventDefault()
    const requestor = reqName.trim()
    const details = reqDetails.trim()
    if (!reqAccountId || !reqTypeId || !requestor || !reqDate || !details || !supabase) {
      setReqStatus({
        type: 'error',
        message: 'Please fill in all fields before submitting.',
      })
      return
    }
    const { data, error } = await supabase
      .from('design_requests')
      .insert({
        account_id: Number(reqAccountId),
        request_type_id: Number(reqTypeId),
        requestor_name: requestor,
        request_date: reqDate,
        details,
      })
      .select('*, accounts(usi), request_type:request_types(name)')
      .single()
    if (error) {
      console.error('Error adding design request:', error)
      setReqStatus({
        type: 'error',
        message: `Could not create design record: ${error.message}`,
      })
      return
    }
    setDesignRequests((prev) => [...prev, data])
    setReqAccountId('')
    setReqTypeId('')
    setReqName('')
    setReqDate('')
    setReqDetails('')
    setReqStatus({
      type: 'success',
      message: 'Design record successfully created.',
    })
  }

  function startEditRequest(request) {
    setEditReqId(request.id)
    setEditReq({
      account_id: request.account_id != null ? String(request.account_id) : '',
      request_type_id:
        request.request_type_id != null ? String(request.request_type_id) : '',
      requestor_name: request.requestor_name ?? '',
      request_date: request.request_date ?? '',
      details: request.details ?? '',
    })
    setReqStatus(null)
  }

  function cancelEditRequest() {
    setEditReqId(null)
  }

  async function saveEditRequest(id) {
    if (!supabase) return
    const requestor = editReq.requestor_name.trim()
    const details = editReq.details.trim()
    if (
      !editReq.account_id ||
      !editReq.request_type_id ||
      !requestor ||
      !editReq.request_date ||
      !details
    ) {
      setReqStatus({
        type: 'error',
        message: 'Please fill in all fields before saving.',
      })
      return
    }
    const { data, error } = await supabase
      .from('design_requests')
      .update({
        account_id: Number(editReq.account_id),
        request_type_id: Number(editReq.request_type_id),
        requestor_name: requestor,
        request_date: editReq.request_date,
        details,
      })
      .eq('id', id)
      .select('*, accounts(usi), request_type:request_types(name)')
    if (error) {
      console.error('Error updating design request:', error)
      setReqStatus({
        type: 'error',
        message: `Could not update design record: ${error.message}`,
      })
      return
    }
    // No rows returned means a Row-Level Security policy blocked the write.
    if (!data || data.length === 0) {
      setReqStatus({
        type: 'error',
        message:
          'Update was blocked by the database (no row changed). Check the ' +
          'Supabase Row-Level Security UPDATE policy on the design_requests table.',
      })
      return
    }
    setDesignRequests((prev) => prev.map((r) => (r.id === id ? data[0] : r)))
    setEditReqId(null)
    setReqStatus({ type: 'success', message: 'Design record successfully updated.' })
  }

  // --- Request Type option management (add / rename / delete) ---

  async function addRequestType(e) {
    e.preventDefault()
    if (!supabase) return
    const name = newTypeName.trim()
    if (!name) {
      setTypeStatus({ type: 'error', message: 'Request type name is required.' })
      return
    }
    const { data, error } = await supabase
      .from('request_types')
      .insert({ name })
      .select('id, name')
      .single()
    if (error) {
      console.error('Error adding request type:', error)
      setTypeStatus({
        type: 'error',
        message: `Could not add request type: ${error.message}`,
      })
      return
    }
    setRequestTypes((prev) =>
      [...prev, data].sort((a, b) =>
        (a.name ?? '').localeCompare(b.name ?? '', undefined, {
          sensitivity: 'base',
        })
      )
    )
    setNewTypeName('')
    setTypeStatus({ type: 'success', message: `Request type “${data.name}” added.` })
  }

  function startEditType(type) {
    setEditingTypeId(type.id)
    setEditingTypeName(type.name ?? '')
    setTypeStatus(null)
  }

  function cancelEditType() {
    setEditingTypeId(null)
    setEditingTypeName('')
  }

  async function saveEditType(id) {
    if (!supabase) return
    const name = editingTypeName.trim()
    if (!name) {
      setTypeStatus({ type: 'error', message: 'Request type name is required.' })
      return
    }
    const { data, error } = await supabase
      .from('request_types')
      .update({ name })
      .eq('id', id)
      .select('id, name')
    if (error) {
      console.error('Error updating request type:', error)
      setTypeStatus({
        type: 'error',
        message: `Could not update request type: ${error.message}`,
      })
      return
    }
    if (!data || data.length === 0) {
      setTypeStatus({
        type: 'error',
        message:
          'Update was blocked by the database (no row changed). Check the ' +
          'Supabase Row-Level Security UPDATE policy on the request_types table.',
      })
      return
    }
    setRequestTypes((prev) =>
      prev
        .map((t) => (t.id === id ? data[0] : t))
        .sort((a, b) =>
          (a.name ?? '').localeCompare(b.name ?? '', undefined, {
            sensitivity: 'base',
          })
        )
    )
    setEditingTypeId(null)
    setEditingTypeName('')
    // A rename reflects everywhere via the FK join; refresh the visible rows.
    fetchDesignRequests()
    setTypeStatus({ type: 'success', message: 'Request type updated.' })
  }

  async function deleteRequestType(id) {
    if (!supabase) return
    const { error } = await supabase.from('request_types').delete().eq('id', id)
    if (error) {
      console.error('Error deleting request type:', error)
      // A foreign-key violation means existing requests still reference this type.
      setTypeStatus({
        type: 'error',
        message: `Could not delete request type: ${error.message}`,
      })
      return
    }
    setRequestTypes((prev) => prev.filter((t) => t.id !== id))
    if (editingTypeId === id) cancelEditType()
    setTypeStatus({ type: 'success', message: 'Request type deleted.' })
  }

  // Search by site (USI), requestor and details, case-insensitive.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return designRequests
    return designRequests.filter((r) =>
      [r.accounts?.usi, r.request_type?.name, r.requestor_name, r.details, r.request_date]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [designRequests, query])

  // Group the visible rows by calendar month, earliest month first, with the
  // earliest dates at the top of each group; rows with no/invalid date fall into
  // a trailing "No date" group. Keyed by "YYYY-MM" so the sort is a plain string
  // compare.
  const monthGroups = useMemo(() => {
    const map = new Map()
    for (const r of filtered) {
      const key = monthLabel(r.request_date) === 'No date'
        ? ''
        : r.request_date.slice(0, 7)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(r)
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        if (a === '') return 1
        if (b === '') return -1
        return a.localeCompare(b)
      })
      .map(([key, rows]) => ({
        key: key || 'no-date',
        label: monthLabel(rows[0].request_date),
        rows: [...rows].sort((x, y) =>
          (x.request_date ?? '').localeCompare(y.request_date ?? '')
        ),
      }))
  }, [filtered])

  // Render a single design request as a table row (edit mode or read-only).
  function renderRequestRow(request) {
    return editReqId === request.id ? (
      <tr key={request.id}>
        <td>
          <select
            value={editReq.account_id}
            onChange={(e) =>
              setEditReq((p) => ({ ...p, account_id: e.target.value }))
            }
          >
            <option value="">Select a site (account)…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.usi}
              </option>
            ))}
          </select>
        </td>
        <td>
          <select
            value={editReq.request_type_id}
            onChange={(e) =>
              setEditReq((p) => ({
                ...p,
                request_type_id: e.target.value,
              }))
            }
          >
            <option value="">Select a request type…</option>
            {requestTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </td>
        <td>
          <input
            type="text"
            value={editReq.requestor_name}
            onChange={(e) =>
              setEditReq((p) => ({
                ...p,
                requestor_name: e.target.value,
              }))
            }
          />
        </td>
        <td>
          <input
            type="date"
            value={editReq.request_date}
            onChange={(e) =>
              setEditReq((p) => ({
                ...p,
                request_date: e.target.value,
              }))
            }
          />
        </td>
        <td>
          <textarea
            value={editReq.details}
            onChange={(e) =>
              setEditReq((p) => ({ ...p, details: e.target.value }))
            }
            rows={2}
          />
        </td>
        <td className="row-actions">
          <button type="button" onClick={() => saveEditRequest(request.id)}>
            Save
          </button>
          <button type="button" onClick={cancelEditRequest}>
            Cancel
          </button>
        </td>
      </tr>
    ) : (
      <tr key={request.id}>
        <td>{request.accounts?.usi ?? '—'}</td>
        <td>{request.request_type?.name ?? '—'}</td>
        <td>{request.requestor_name}</td>
        <td className="dr-date">{request.request_date}</td>
        <td>{request.details}</td>
        <td className="row-actions">
          <button type="button" onClick={() => startEditRequest(request)}>
            Edit
          </button>
        </td>
      </tr>
    )
  }

  return (
    <main className="design-requests-page">
      <Link to="/" className="back-link">
        ← Back to home
      </Link>
      <h1>Design Requests</h1>

      <form className="design-request-form" onSubmit={addDesignRequest}>
        <select
          value={reqAccountId}
          onChange={(e) => setReqAccountId(e.target.value)}
        >
          <option value="">Select a site (account)…</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.usi}
            </option>
          ))}
        </select>
        <select value={reqTypeId} onChange={(e) => setReqTypeId(e.target.value)}>
          <option value="">Select a request type…</option>
          {requestTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={reqName}
          onChange={(e) => setReqName(e.target.value)}
          placeholder="Name of requestor"
        />
        <input
          type="date"
          value={reqDate}
          onChange={(e) => setReqDate(e.target.value)}
        />
        <textarea
          value={reqDetails}
          onChange={(e) => setReqDetails(e.target.value)}
          placeholder="Details for request"
          rows={3}
        />
        <button type="submit">Add Request</button>
        {reqStatus && (
          <p className={`form-status ${reqStatus.type}`}>{reqStatus.message}</p>
        )}
      </form>

      <details className="request-type-manager">
        <summary>Manage request types</summary>
        <form className="request-type-add" onSubmit={addRequestType}>
          <input
            type="text"
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value)}
            placeholder="New request type…"
          />
          <button type="submit">Add type</button>
        </form>
        <ul className="request-type-list">
          {requestTypes.length === 0 && (
            <li className="empty">No request types yet</li>
          )}
          {requestTypes.map((type) =>
            editingTypeId === type.id ? (
              <li key={type.id}>
                <input
                  type="text"
                  value={editingTypeName}
                  onChange={(e) => setEditingTypeName(e.target.value)}
                />
                <span className="request-type-actions">
                  <button type="button" onClick={() => saveEditType(type.id)}>
                    Save
                  </button>
                  <button type="button" onClick={cancelEditType}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
              <li key={type.id}>
                <span className="request-type-name">{type.name}</span>
                <span className="request-type-actions">
                  <button type="button" onClick={() => startEditType(type)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRequestType(type.id)}
                  >
                    Delete
                  </button>
                </span>
              </li>
            )
          )}
        </ul>
        {typeStatus && (
          <p className={`form-status ${typeStatus.type}`}>{typeStatus.message}</p>
        )}
      </details>

      <input
        type="search"
        className="design-request-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by site, requestor or details…"
      />

      <table className="design-request-table">
        <thead>
          <tr>
            <th>Site</th>
            <th>Request Type</th>
            <th>Requestor</th>
            <th>Date</th>
            <th>Details</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td className="empty" colSpan={6}>
                {designRequests.length === 0
                  ? 'No design requests yet'
                  : `No design requests match “${query}”`}
              </td>
            </tr>
          )}
          {monthGroups.map((group) => (
            <Fragment key={group.key}>
              <tr className="month-group">
                <th colSpan={6} scope="colgroup">
                  {group.label}
                </th>
              </tr>
              {group.rows.map((request) => renderRequestRow(request))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </main>
  )
}

export default DesignRequestsPage
