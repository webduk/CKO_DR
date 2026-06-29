import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import supabase from './supabase-client'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Design-request lifecycle statuses. 'closed' records are hidden from the list,
// so only 'active' and 'on_hold' rows are ever shown.
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'closed', label: 'Closed' },
]
const STATUS_LABELS = Object.fromEntries(
  STATUS_OPTIONS.map((s) => [s.value, s.label])
)

// Supabase Storage bucket that holds design-request file attachments. The file
// metadata (name, path, size) lives in the `design_request_attachments` table;
// the binary lives in this bucket. See DEPLOY.md / the SQL in the PR for setup.
const ATTACH_BUCKET = 'design-request-files'

// Columns pulled for every design request, including its embedded attachment
// rows so the file list renders straight from the joined data.
const REQUEST_SELECT =
  '*, accounts(usi), request_type:request_types(name), ' +
  'design_request_attachments(id, file_name, storage_path, mime_type, size_bytes)'

// Public download URL for a stored file.
function attachmentUrl(path) {
  if (!supabase) return '#'
  return supabase.storage.from(ATTACH_BUCKET).getPublicUrl(path).data.publicUrl
}

// "1.4 MB" / "820 B" — compact human-readable size for the file chips.
function formatBytes(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

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
  // The new design request's lifecycle status ('active' | 'closed').
  const [reqStatusValue, setReqStatusValue] = useState('active')
  const [reqStatus, setReqStatus] = useState(null)
  // Files dropped on the create form before the record exists; uploaded right
  // after the design request is inserted (we need its id for the storage path).
  const [pendingFiles, setPendingFiles] = useState([])
  // Id of the request currently uploading attachments (drives a busy state on
  // its drop zone); null when nothing is uploading.
  const [uploadingId, setUploadingId] = useState(null)
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
    status: 'active',
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
      .select(REQUEST_SELECT)
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
        status: reqStatusValue,
      })
      .select(REQUEST_SELECT)
      .single()
    if (error) {
      console.error('Error adding design request:', error)
      setReqStatus({
        type: 'error',
        message: `Could not create design record: ${error.message}`,
      })
      return
    }
    // Upload any files dropped on the create form now that the record (and its
    // id, needed for the storage path) exists. Surface partial failures but
    // keep the record either way.
    let attachments = []
    let attachError = null
    if (pendingFiles.length > 0) {
      setUploadingId('new')
      try {
        attachments = await uploadFilesForRequest(data.id, pendingFiles)
      } catch (err) {
        console.error('Error uploading attachments:', err)
        attachError = err.message
      }
      setUploadingId(null)
    }
    const created = { ...data, design_request_attachments: attachments }

    setDesignRequests((prev) => [...prev, created])
    setReqAccountId('')
    setReqTypeId('')
    setReqName('')
    setReqDate('')
    setReqDetails('')
    setReqStatusValue('active')
    setPendingFiles([])
    setReqStatus(
      attachError
        ? {
            type: 'error',
            message: `Record created, but some files failed to upload: ${attachError}`,
          }
        : { type: 'success', message: 'Design record successfully created.' }
    )
  }

  // --- File attachments (Supabase Storage + design_request_attachments) ---

  // Upload each File to the bucket and insert its metadata row. Returns the
  // inserted attachment rows. Throws on the first failure so callers can report
  // it. The index keeps paths unique when several files share a timestamp.
  async function uploadFilesForRequest(requestId, files) {
    const inserted = []
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      const safeName = file.name.replace(/[^\w.-]+/g, '_')
      const path = `${requestId}/${Date.now()}-${i}-${safeName}`
      const { error: upErr } = await supabase.storage
        .from(ATTACH_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || undefined })
      if (upErr) throw upErr
      const { data, error } = await supabase
        .from('design_request_attachments')
        .insert({
          design_request_id: requestId,
          file_name: file.name,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
        })
        .select('id, file_name, storage_path, mime_type, size_bytes')
        .single()
      if (error) throw error
      inserted.push(data)
    }
    return inserted
  }

  // Upload files dropped onto an existing request's row and merge them into the
  // visible attachment list.
  async function addFilesToRequest(requestId, files) {
    if (!supabase || files.length === 0) return
    setUploadingId(requestId)
    try {
      const inserted = await uploadFilesForRequest(requestId, files)
      setDesignRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? {
                ...r,
                design_request_attachments: [
                  ...(r.design_request_attachments ?? []),
                  ...inserted,
                ],
              }
            : r
        )
      )
      setReqStatus({
        type: 'success',
        message: `Attached ${inserted.length} file${inserted.length === 1 ? '' : 's'}.`,
      })
    } catch (err) {
      console.error('Error uploading attachments:', err)
      setReqStatus({ type: 'error', message: `Could not upload: ${err.message}` })
    }
    setUploadingId(null)
  }

  // Delete a stored file and its metadata row, then drop it from the row's list.
  async function deleteAttachment(requestId, attachment) {
    if (!supabase) return
    const { error: rmErr } = await supabase.storage
      .from(ATTACH_BUCKET)
      .remove([attachment.storage_path])
    if (rmErr) {
      console.error('Error removing file from storage:', rmErr)
      setReqStatus({ type: 'error', message: `Could not delete file: ${rmErr.message}` })
      return
    }
    const { error } = await supabase
      .from('design_request_attachments')
      .delete()
      .eq('id', attachment.id)
    if (error) {
      console.error('Error deleting attachment row:', error)
      setReqStatus({ type: 'error', message: `Could not delete file: ${error.message}` })
      return
    }
    setDesignRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? {
              ...r,
              design_request_attachments: (r.design_request_attachments ?? []).filter(
                (a) => a.id !== attachment.id
              ),
            }
          : r
      )
    )
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
      status: request.status ?? 'active',
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
    // Site and request type are optional: legacy requests (linked via the older
    // company_id model) have no account_id/request_type_id, and forcing them
    // would block editing those records. Requestor, date and details remain
    // required.
    if (!requestor || !editReq.request_date || !details) {
      setReqStatus({
        type: 'error',
        message: 'Requestor, date and details are required.',
      })
      return
    }
    const { data, error } = await supabase
      .from('design_requests')
      .update({
        // Empty string → null (not Number('') === 0, which would be a bogus FK).
        account_id: editReq.account_id ? Number(editReq.account_id) : null,
        request_type_id: editReq.request_type_id
          ? Number(editReq.request_type_id)
          : null,
        requestor_name: requestor,
        request_date: editReq.request_date,
        details,
        status: editReq.status,
      })
      .eq('id', id)
      .select(REQUEST_SELECT)
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

  // One-click close (archive) without entering edit mode. Closing flips status
  // to 'closed', which drops the row out of the visible list. To reopen or set
  // "On Hold", use Edit and pick the status there.
  async function closeRequest(request) {
    if (!supabase) return
    const { data, error } = await supabase
      .from('design_requests')
      .update({ status: 'closed' })
      .eq('id', request.id)
      .select(REQUEST_SELECT)
    if (error) {
      console.error('Error updating status:', error)
      setReqStatus({
        type: 'error',
        message: `Could not update status: ${error.message}`,
      })
      return
    }
    if (!data || data.length === 0) {
      setReqStatus({
        type: 'error',
        message:
          'Status change was blocked by the database (no row changed). Check the ' +
          'Supabase Row-Level Security UPDATE policy on the design_requests table.',
      })
      return
    }
    setDesignRequests((prev) =>
      prev.map((r) => (r.id === request.id ? data[0] : r))
    )
    setReqStatus({ type: 'success', message: 'Request closed.' })
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

  // Closed requests are archived: only active / on-hold rows are shown.
  // Search by site (USI), requestor and details, case-insensitive.
  const filtered = useMemo(() => {
    const visible = designRequests.filter((r) => r.status !== 'closed')
    const q = query.trim().toLowerCase()
    if (!q) return visible
    return visible.filter((r) =>
      [r.accounts?.usi, r.request_type?.name, r.requestor_name, r.details, r.request_date, r.status]
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
        <td>
          <select
            value={editReq.status}
            onChange={(e) =>
              setEditReq((p) => ({ ...p, status: e.target.value }))
            }
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
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
      <Fragment key={request.id}>
        <tr>
          <td>{request.accounts?.usi ?? '—'}</td>
          <td>{request.request_type?.name ?? '—'}</td>
          <td>{request.requestor_name}</td>
          <td className="dr-date">{request.request_date}</td>
          <td>{request.details}</td>
          <td>
            <span className={`status-badge status-badge--${request.status}`}>
              {STATUS_LABELS[request.status] ?? request.status}
            </span>
          </td>
          <td className="row-actions">
            <button type="button" onClick={() => startEditRequest(request)}>
              Edit
            </button>
            <button type="button" onClick={() => closeRequest(request)}>
              Close
            </button>
          </td>
        </tr>
        <tr className="dr-attachments-row">
          <td colSpan={7}>{renderAttachments(request)}</td>
        </tr>
      </Fragment>
    )
  }

  // Attachment chips + drop zone shown beneath each request in read mode.
  function renderAttachments(request) {
    const files = request.design_request_attachments ?? []
    return (
      <div className="dr-attachments">
        <span className="dr-attachments-label">
          Attachments{files.length ? ` (${files.length})` : ''}
        </span>
        {files.length > 0 && (
          <ul className="attachment-list">
            {files.map((att) => (
              <li key={att.id} className="attachment-chip">
                <a
                  href={attachmentUrl(att.storage_path)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {att.file_name}
                </a>
                {att.size_bytes != null && (
                  <span className="attachment-size">
                    {formatBytes(att.size_bytes)}
                  </span>
                )}
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label={`Delete ${att.file_name}`}
                  onClick={() => deleteAttachment(request.id, att)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <FileDropzone
          compact
          disabled={uploadingId === request.id}
          onFiles={(dropped) => addFilesToRequest(request.id, dropped)}
          label={
            uploadingId === request.id
              ? 'Uploading…'
              : 'Drag & drop files here, or click to attach'
          }
        />
      </div>
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
        <select
          value={reqStatusValue}
          onChange={(e) => setReqStatusValue(e.target.value)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <FileDropzone
          onFiles={(files) => setPendingFiles((prev) => [...prev, ...files])}
          disabled={uploadingId === 'new'}
          label={
            uploadingId === 'new'
              ? 'Uploading…'
              : 'Drag & drop files here, or click to attach'
          }
        />
        {pendingFiles.length > 0 && (
          <ul className="attachment-pending-list">
            {pendingFiles.map((file, i) => (
              <li key={`${file.name}-${i}`}>
                <span className="attachment-name">{file.name}</span>
                <span className="attachment-size">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setPendingFiles((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
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
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td className="empty" colSpan={7}>
                {query
                  ? `No design requests match “${query}”`
                  : 'No active or on-hold design requests'}
              </td>
            </tr>
          )}
          {monthGroups.map((group) => (
            <Fragment key={group.key}>
              <tr className="month-group">
                <th colSpan={7} scope="colgroup">
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

// Drag-and-drop (and click-to-choose) zone for selecting multiple files. Calls
// onFiles with an array of File objects; the parent decides what to do with
// them (queue for upload, or upload immediately).
function FileDropzone({ onFiles, disabled = false, compact = false, label }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  function emit(fileList) {
    const files = [...fileList]
    if (files.length) onFiles(files)
  }

  return (
    <div
      className={
        'file-dropzone' +
        (compact ? ' compact' : '') +
        (dragging ? ' dragging' : '') +
        (disabled ? ' disabled' : '')
      }
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) emit(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          emit(e.target.files)
          e.target.value = ''
        }}
      />
      <span>{label ?? 'Drag & drop files here, or click to choose'}</span>
    </div>
  )
}

export default DesignRequestsPage
