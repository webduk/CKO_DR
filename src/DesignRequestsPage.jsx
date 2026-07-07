import { useState, useEffect, useMemo, useRef } from 'react'
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

// Priority levels for a design request, most urgent first. New rows default to
// 'mid' (see supabase/design_request_priority.sql).
const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'mid', label: 'Mid' },
  { value: 'low', label: 'Low' },
]
const PRIORITY_LABELS = Object.fromEntries(
  PRIORITY_OPTIONS.map((p) => [p.value, p.label])
)

// Company tags a request can be ticked against. Each is an independent boolean
// column on design_requests; a request may belong to several. These feed the
// ARW / MESO / WPA count widgets on the home page.
const COMPANY_TAGS = [
  { key: 'arw', label: 'ARW' },
  { key: 'meso', label: 'MESO' },
  { key: 'wpa', label: 'WPA' },
]

// The two kinds of files that attach to a design request. Each has its own
// Storage bucket and metadata table (see supabase/design_request_attachments.sql
// and supabase/design_request_install_specs.sql). `embed` is the embedded-
// relation name pulled in REQUEST_SELECT so the file list renders from the join.
const FILE_KINDS = {
  attachment: {
    bucket: 'design-request-files',
    table: 'design_request_attachments',
    embed: 'design_request_attachments',
  },
  spec: {
    bucket: 'design-request-install-specs',
    table: 'design_request_install_specs',
    embed: 'design_request_install_specs',
  },
}

// Columns pulled for every design request, including its embedded attachment and
// installation-spec rows so both file lists render straight from the joined data.
const REQUEST_SELECT =
  '*, accounts(usi), request_type:request_types(name), ' +
  'design_request_attachments(id, file_name, storage_path, mime_type, size_bytes), ' +
  'design_request_install_specs(id, file_name, storage_path, mime_type, size_bytes)'

// Public download URL for a stored file in the given bucket.
function fileUrl(bucket, path) {
  if (!supabase) return '#'
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
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

// "16 Jun 2026" from an ISO date string. Parsed off the string (not via
// `new Date()`) to avoid a timezone shift rolling the day backwards.
function formatDate(dateStr) {
  const [year, month, day] = (dateStr ?? '').split('-')
  const idx = Number(month) - 1
  if (!year || !day || idx < 0 || idx > 11) return dateStr ?? '—'
  return `${Number(day)} ${MONTH_NAMES[idx].slice(0, 3)} ${year}`
}

// Today's local date as "YYYY-MM-DD", used to stamp closed_at. Built from the
// local calendar parts so it matches the day the user sees (no UTC rollover).
function todayISO() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function DesignRequestsPage({ onRequestsChanged }) {
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
  // The new design request's priority ('critical' | 'mid' | 'low').
  const [reqPriorityValue, setReqPriorityValue] = useState('mid')
  // Which company boxes (ARW/MESO/WPA) are ticked on the create form.
  const [reqCompanies, setReqCompanies] = useState({
    arw: false,
    meso: false,
    wpa: false,
  })
  const [reqStatus, setReqStatus] = useState(null)
  // The create form is hidden behind a large "Add Request" button until the
  // user opens it, keeping the page compact by default.
  const [showForm, setShowForm] = useState(false)
  // Files dropped on the create form before the record exists; uploaded right
  // after the design request is inserted (we need its id for the storage path).
  const [pendingFiles, setPendingFiles] = useState([])
  // Key of the file section currently uploading, `${kind}:${requestId}` (or
  // 'attachment:new' for the create form); null when idle. Drives the busy
  // state on the matching drop zone so the two sections track independently.
  const [uploadingKey, setUploadingKey] = useState(null)
  const [query, setQuery] = useState('')
  // Filter dropdowns above the table: 'all' shows everything, otherwise a
  // specific priority ('critical' | 'mid' | 'low') or status ('active' |
  // 'on_hold'). Closed rows are always hidden regardless.
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  // When true, each record row shows an inline status dropdown for quick status
  // changes without opening the full editor. Toggled by the "Quick Status"
  // button above the table; off by default so the table reads as a clean
  // at-a-glance summary. The per-row "Modify" button that opens the field editor
  // (where the record is saved) is always shown, independent of this.
  const [modifyMode, setModifyMode] = useState(false)
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
    priority: 'mid',
    arw: false,
    meso: false,
    wpa: false,
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
        priority: reqPriorityValue,
        arw: reqCompanies.arw,
        meso: reqCompanies.meso,
        wpa: reqCompanies.wpa,
        closed_at: reqStatusValue === 'closed' ? todayISO() : null,
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
      setUploadingKey('attachment:new')
      try {
        attachments = await uploadFilesForRequest(data.id, pendingFiles, 'attachment')
      } catch (err) {
        console.error('Error uploading attachments:', err)
        attachError = err.message
      }
      setUploadingKey(null)
    }
    const created = { ...data, design_request_attachments: attachments }

    setDesignRequests((prev) => [...prev, created])
    setReqAccountId('')
    setReqTypeId('')
    setReqName('')
    setReqDate('')
    setReqDetails('')
    setReqStatusValue('active')
    setReqPriorityValue('mid')
    setReqCompanies({ arw: false, meso: false, wpa: false })
    setPendingFiles([])
    // Refresh the home-page ARW/MESO/WPA widgets to include the new request.
    onRequestsChanged?.()
    setReqStatus(
      attachError
        ? {
            type: 'error',
            message: `Record created, but some files failed to upload: ${attachError}`,
          }
        : { type: 'success', message: 'Design record successfully created.' }
    )
  }

  // --- Files: attachments + installation specs (Supabase Storage + tables) ---
  // All three helpers take a `kind` ('attachment' | 'spec') that selects the
  // bucket, metadata table, and embedded-relation key from FILE_KINDS.

  // Upload each File to the kind's bucket and insert its metadata row. Returns
  // the inserted rows. Throws on the first failure so callers can report it. The
  // index keeps paths unique when several files share a timestamp.
  async function uploadFilesForRequest(requestId, files, kind) {
    const { bucket, table } = FILE_KINDS[kind]
    const inserted = []
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      const safeName = file.name.replace(/[^\w.-]+/g, '_')
      const path = `${requestId}/${Date.now()}-${i}-${safeName}`
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: false, contentType: file.type || undefined })
      if (upErr) throw upErr
      const { data, error } = await supabase
        .from(table)
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
  // visible list for that kind.
  async function addFilesToRequest(requestId, files, kind) {
    if (!supabase || files.length === 0) return
    const { embed } = FILE_KINDS[kind]
    setUploadingKey(`${kind}:${requestId}`)
    try {
      const inserted = await uploadFilesForRequest(requestId, files, kind)
      setDesignRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? { ...r, [embed]: [...(r[embed] ?? []), ...inserted] }
            : r
        )
      )
      setReqStatus({
        type: 'success',
        message: `Uploaded ${inserted.length} file${inserted.length === 1 ? '' : 's'}.`,
      })
    } catch (err) {
      console.error('Error uploading files:', err)
      setReqStatus({ type: 'error', message: `Could not upload: ${err.message}` })
    }
    setUploadingKey(null)
  }

  // Delete a stored file and its metadata row, then drop it from the row's list.
  async function deleteFile(requestId, file, kind) {
    if (!supabase) return
    const { bucket, table, embed } = FILE_KINDS[kind]
    const { error: rmErr } = await supabase.storage
      .from(bucket)
      .remove([file.storage_path])
    if (rmErr) {
      console.error('Error removing file from storage:', rmErr)
      setReqStatus({ type: 'error', message: `Could not delete file: ${rmErr.message}` })
      return
    }
    const { error } = await supabase.from(table).delete().eq('id', file.id)
    if (error) {
      console.error('Error deleting file row:', error)
      setReqStatus({ type: 'error', message: `Could not delete file: ${error.message}` })
      return
    }
    setDesignRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? { ...r, [embed]: (r[embed] ?? []).filter((f) => f.id !== file.id) }
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
      priority: request.priority ?? 'mid',
      arw: request.arw ?? false,
      meso: request.meso ?? false,
      wpa: request.wpa ?? false,
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
    // Stamp closed_at when this save closes the request; keep the existing date
    // if it was already closed, and clear it if the request is being reopened.
    const prev = designRequests.find((r) => r.id === id)
    const closed_at =
      editReq.status === 'closed'
        ? prev?.status === 'closed'
          ? prev.closed_at ?? todayISO()
          : todayISO()
        : null
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
        closed_at,
        details,
        status: editReq.status,
        priority: editReq.priority,
        arw: editReq.arw,
        meso: editReq.meso,
        wpa: editReq.wpa,
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
    // Company tags or status may have changed; refresh the home-page widgets.
    onRequestsChanged?.()
    setReqStatus({ type: 'success', message: 'Design record successfully updated.' })
  }

  // Permanently delete a design request (unlike Close, which only archives).
  // The FK from both attachment tables is ON DELETE CASCADE, so their metadata
  // rows go automatically — but the Storage objects are not cascaded, so we
  // remove those first (best-effort) to avoid orphaned files.
  async function deleteDesignRequest(request) {
    if (!supabase) return
    if (
      !window.confirm(
        'Do you really wish to make this change?\n\n' +
          'This permanently deletes the design request and any attached files, ' +
          'and cannot be undone. Click OK to confirm.'
      )
    ) {
      return
    }
    for (const [kind, embed] of [
      ['attachment', 'design_request_attachments'],
      ['spec', 'design_request_install_specs'],
    ]) {
      const paths = (request[embed] ?? [])
        .map((f) => f.storage_path)
        .filter(Boolean)
      if (paths.length) {
        const { error: rmErr } = await supabase.storage
          .from(FILE_KINDS[kind].bucket)
          .remove(paths)
        if (rmErr) console.error(`Error removing ${kind} files:`, rmErr)
      }
    }
    // .select('id') so zero rows back (with no error) reveals an RLS DELETE
    // policy silently blocking the write instead of a false success.
    const { data, error } = await supabase
      .from('design_requests')
      .delete()
      .eq('id', request.id)
      .select('id')
    if (error) {
      console.error('Error deleting design request:', error)
      setReqStatus({ type: 'error', message: `Could not delete: ${error.message}` })
      return
    }
    if (!data || data.length === 0) {
      setReqStatus({
        type: 'error',
        message:
          'Delete was blocked by the database (no row removed). Check the ' +
          'Supabase Row-Level Security DELETE policy on the design_requests table.',
      })
      return
    }
    setDesignRequests((prev) => prev.filter((r) => r.id !== request.id))
    if (editReqId === request.id) setEditReqId(null)
    // A deleted request may have been ticked ARW/MESO/WPA; refresh the widgets.
    onRequestsChanged?.()
    setReqStatus({ type: 'success', message: 'Design request deleted.' })
  }

  // One-click close from a row's own button: confirm, then archive it. Closing
  // drops the row off the home summary; it stays available on the All Design
  // Requests page.
  async function closeRequest(request) {
    if (request.status === 'closed') return
    if (
      !window.confirm(
        'Do you really wish to make this change?\n\n' +
          'This closes the design request and removes it from the home page ' +
          '(it stays on the All Design Requests page). Click OK to confirm.'
      )
    ) {
      return
    }
    await updateStatus(request, 'closed')
  }

  // Change just a request's status from the inline dropdown shown in modify
  // mode (no need to open the full editor). Setting it to 'closed' archives the
  // row, which drops it out of the visible list.
  async function updateStatus(request, status) {
    if (!supabase || status === request.status) return
    // Stamp the close date when archiving; clear it when reopening. (This is
    // only reached on an actual status change, so a fresh date is always right.)
    const closed_at = status === 'closed' ? todayISO() : null
    const { data, error } = await supabase
      .from('design_requests')
      .update({ status, closed_at })
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
    // Closing/reopening changes which requests are active; refresh the widgets.
    onRequestsChanged?.()
    setReqStatus({
      type: 'success',
      message:
        status === 'closed'
          ? `Request closed on ${formatDate(closed_at)}.`
          : 'Status updated.',
    })
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
    let visible = designRequests.filter((r) => r.status !== 'closed')
    if (priorityFilter !== 'all') {
      visible = visible.filter((r) => (r.priority ?? 'mid') === priorityFilter)
    }
    if (statusFilter !== 'all') {
      visible = visible.filter((r) => r.status === statusFilter)
    }
    const q = query.trim().toLowerCase()
    if (!q) return visible
    return visible.filter((r) =>
      [r.accounts?.usi, r.request_type?.name, r.requestor_name, r.details, r.request_date, r.status, r.priority]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [designRequests, query, priorityFilter, statusFilter])

  // Critical-priority requests float to the top of the table; within each
  // group rows are sorted by date (earliest first), rows with no/invalid date
  // sorting last.
  const sortedRequests = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aCritical = a.priority === 'critical'
      const bCritical = b.priority === 'critical'
      if (aCritical !== bCritical) return aCritical ? -1 : 1
      const da = a.request_date ?? ''
      const db = b.request_date ?? ''
      if (!da) return 1
      if (!db) return -1
      return da.localeCompare(db)
    })
  }, [filtered])

  // Render a single design request. Read mode is a compact at-a-glance summary
  // row (priority, request type, date, details + a single Edit button). Edit
  // mode expands to a full-width editor row holding every field, the status and
  // the file sections.
  function renderRequestRow(request) {
    return editReqId === request.id ? (
      <tr key={request.id} className="dr-editor-row">
        <td colSpan={6}>
          <div className="dr-editor">
            <label className="dr-editor-field">
              <span>Site (account)</span>
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
            </label>
            <label className="dr-editor-field">
              <span>Request Type</span>
              <select
                value={editReq.request_type_id}
                onChange={(e) =>
                  setEditReq((p) => ({ ...p, request_type_id: e.target.value }))
                }
              >
                <option value="">Select a request type…</option>
                {requestTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="dr-editor-field">
              <span>Requestor</span>
              <input
                type="text"
                value={editReq.requestor_name}
                onChange={(e) =>
                  setEditReq((p) => ({ ...p, requestor_name: e.target.value }))
                }
              />
            </label>
            <label className="dr-editor-field">
              <span>Priority</span>
              <select
                value={editReq.priority}
                onChange={(e) =>
                  setEditReq((p) => ({ ...p, priority: e.target.value }))
                }
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="dr-editor-field">
              <span>Date</span>
              <input
                type="date"
                value={editReq.request_date}
                onChange={(e) =>
                  setEditReq((p) => ({ ...p, request_date: e.target.value }))
                }
              />
            </label>
            <label className="dr-editor-field">
              <span>Status</span>
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
            </label>
            <div className="dr-editor-field dr-editor-field--full">
              <span>Companies</span>
              <div className="company-tags">
                {COMPANY_TAGS.map((tag) => (
                  <label key={tag.key} className="company-tag">
                    <input
                      type="checkbox"
                      checked={!!editReq[tag.key]}
                      onChange={(e) =>
                        setEditReq((p) => ({ ...p, [tag.key]: e.target.checked }))
                      }
                    />
                    {tag.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="dr-editor-field dr-editor-field--full">
              <span>Details</span>
              <textarea
                value={editReq.details}
                onChange={(e) =>
                  setEditReq((p) => ({ ...p, details: e.target.value }))
                }
                rows={3}
              />
            </label>
            <div className="dr-editor-field--full">
              {renderFileSection(request, 'attachment', 'Attachments')}
              {renderFileSection(request, 'spec', 'Installation Specifications')}
            </div>
            <div className="row-actions dr-editor-actions">
              <button type="button" onClick={() => saveEditRequest(request.id)}>
                Save
              </button>
              <button type="button" onClick={cancelEditRequest}>
                Cancel
              </button>
              <button
                type="button"
                className="dr-delete-btn"
                onClick={() => deleteDesignRequest(request)}
              >
                Delete
              </button>
            </div>
          </div>
        </td>
      </tr>
    ) : (
      <tr key={request.id}>
        <td>
          <span
            className={`status-badge priority-badge priority-badge--${request.priority ?? 'mid'}`}
          >
            {PRIORITY_LABELS[request.priority] ?? request.priority ?? '—'}
          </span>
        </td>
        <td>
          {request.request_type?.name ? (
            <span className="type-badge">{request.request_type.name}</span>
          ) : (
            '—'
          )}
        </td>
        <td className="dr-requestor">{request.requestor_name ?? '—'}</td>
        <td className="dr-date">{formatDate(request.request_date)}</td>
        <td className="dr-details">
          <span className="dr-details-clamp" title={request.details}>
            {request.details}
          </span>
        </td>
        <td className="row-actions">
          <button
            type="button"
            className="dr-modify-btn"
            onClick={() => startEditRequest(request)}
          >
            Modify
          </button>
          <button
            type="button"
            className="dr-close-btn"
            onClick={() => closeRequest(request)}
          >
            Close
          </button>
          <button
            type="button"
            className="dr-delete-btn"
            onClick={() => deleteDesignRequest(request)}
          >
            Delete
          </button>
          {modifyMode && (
            <select
              className="dr-status-select"
              value={request.status}
              aria-label="Change status"
              onChange={(e) => updateStatus(request, e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </td>
      </tr>
    )
  }

  // File chips + drop zone for one kind (attachments or installation specs),
  // shown beneath each request in read mode.
  function renderFileSection(request, kind, label) {
    const { bucket, embed } = FILE_KINDS[kind]
    const files = request[embed] ?? []
    const busy = uploadingKey === `${kind}:${request.id}`
    const emptyLabel =
      kind === 'spec'
        ? 'Drag & drop installation specs here, or click to upload'
        : 'Drag & drop files here, or click to attach'
    return (
      <div className="dr-attachments">
        <span className="dr-attachments-label">
          {label}
          {files.length ? ` (${files.length})` : ''}
        </span>
        {files.length > 0 && (
          <ul className="attachment-list">
            {files.map((f) => (
              <li key={f.id} className="attachment-chip">
                <a
                  href={fileUrl(bucket, f.storage_path)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {f.file_name}
                </a>
                {f.size_bytes != null && (
                  <span className="attachment-size">
                    {formatBytes(f.size_bytes)}
                  </span>
                )}
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label={`Delete ${f.file_name}`}
                  onClick={() => deleteFile(request.id, f, kind)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <FileDropzone
          compact
          disabled={busy}
          onFiles={(dropped) => addFilesToRequest(request.id, dropped, kind)}
          label={busy ? 'Uploading…' : emptyLabel}
        />
      </div>
    )
  }

  return (
    <section id="design-requests" className="design-requests-page">
      <h1>Design Requests</h1>
      <p className="page-intro">
        Active and on-hold requests. Closing a request removes it from here —
        find every request, including closed ones, on the{' '}
        <Link to="/design-requests">All Design Requests</Link> page.
      </p>

      {!showForm && (
        <div className="design-request-actions">
          <button
            type="button"
            className="add-request-cta"
            onClick={() => setShowForm(true)}
          >
            + Add Request
          </button>
          <button
            type="button"
            className={`modify-request-toggle${modifyMode ? ' active' : ''}`}
            aria-pressed={modifyMode}
            onClick={() => setModifyMode((m) => !m)}
          >
            {modifyMode ? 'Done' : 'Quick Status'}
          </button>
        </div>
      )}

      {showForm && (
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
          value={reqPriorityValue}
          onChange={(e) => setReqPriorityValue(e.target.value)}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label} priority
            </option>
          ))}
        </select>
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
        <fieldset className="company-tags-field">
          <legend>Companies</legend>
          <div className="company-tags">
            {COMPANY_TAGS.map((tag) => (
              <label key={tag.key} className="company-tag">
                <input
                  type="checkbox"
                  checked={reqCompanies[tag.key]}
                  onChange={(e) =>
                    setReqCompanies((prev) => ({
                      ...prev,
                      [tag.key]: e.target.checked,
                    }))
                  }
                />
                {tag.label}
              </label>
            ))}
          </div>
        </fieldset>
        <FileDropzone
          onFiles={(files) => setPendingFiles((prev) => [...prev, ...files])}
          disabled={uploadingKey === 'attachment:new'}
          label={
            uploadingKey === 'attachment:new'
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
        <div className="design-request-form-actions">
          <button type="submit" className="add-request-submit">
            Add Request
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setShowForm(false)}
          >
            Cancel
          </button>
        </div>
        {reqStatus && (
          <p className={`form-status ${reqStatus.type}`}>{reqStatus.message}</p>
        )}
      </form>
      )}

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

      <div className="design-request-filters">
        <input
          type="search"
          className="design-request-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by site, requestor or details…"
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
          {STATUS_OPTIONS.filter((s) => s.value !== 'closed').map((s) => (
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
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td className="empty" colSpan={6}>
                {query
                  ? `No design requests match “${query}”`
                  : 'No active or on-hold design requests'}
              </td>
            </tr>
          )}
          {sortedRequests.map((request) => renderRequestRow(request))}
        </tbody>
      </table>
      </div>
    </section>
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
