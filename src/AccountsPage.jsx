import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import supabase from './supabase-client'

// All seven role fields are foreign keys to the Companies table.
// `key` is the column on `accounts`; `alias` is the embedded-relation name
// used when joining back to Companies for display.
const ROLE_FIELDS = [
  { key: 'builder_id', alias: 'builder', label: 'Builder' },
  { key: 'pm_company_id', alias: 'pm_company', label: 'PM Company' },
  { key: 'developer_id', alias: 'developer', label: 'Developer' },
  { key: 'shoring_id', alias: 'shoring', label: 'Shoring' },
  { key: 'wd_id', alias: 'wd', label: 'WD' },
  { key: 'architect_id', alias: 'architect', label: 'Architect' },
  { key: 'consultants_id', alias: 'consultants', label: 'Consultants' },
]

const SELECT = [
  '*',
  ...ROLE_FIELDS.map((f) => `${f.alias}:Companies!${f.key}(Name)`),
].join(', ')

const EMPTY_FORM = {
  usi: '',
  street_address: '',
  suburb: '',
  postcode: '',
  notes: '',
  ...Object.fromEntries(ROLE_FIELDS.map((f) => [f.key, ''])),
}

// The USI is formatted Site-Area-Year (e.g. BeachSt5-HUS-26); the "Area" is the
// middle segment, which we sort the table by. Every USI ends in the year, so we
// take the segment just before it — this equals the middle for a clean 3-part
// USI but still finds the area when a site name itself contains a hyphen
// (e.g. FLORAST31-25-ARNCLIFFE-26 -> ARNCLIFFE).
function usiArea(usi) {
  const parts = (usi ?? '').split('-')
  return (parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? '').trim()
}

function AccountsPage() {
  const [companies, setCompanies] = useState([])
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [status, setStatus] = useState(null)
  // `editingId` is the account row currently in edit mode (null = none);
  // `editForm` holds its in-progress values until saved or cancelled.
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  // When a role's dropdown is switched to "Create new company…", `creatingRole`
  // holds that role's FK key and `newCompany` holds the in-progress values.
  const [creatingRole, setCreatingRole] = useState(null)
  const [newCompany, setNewCompany] = useState({ name: '', type: '' })
  // Free-form text typed into the search box, matched against the USI, address
  // fields, notes, and every role company name shown in the table.
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchCompanies()
    fetchAccounts()
  }, [])

  async function fetchCompanies() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('Companies')
      .select('*')
      .order('Name', { ascending: true })
    if (error) {
      console.error('Error fetching companies:', error)
      return
    }
    // Sort the options case-insensitively so every role dropdown lists
    // companies in plain alphabetical order, regardless of DB collation.
    const sorted = (data ?? []).sort((a, b) =>
      (a.Name ?? '').localeCompare(b.Name ?? '', undefined, {
        sensitivity: 'base',
      })
    )
    setCompanies(sorted)
  }

  async function fetchAccounts() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('accounts')
      .select(SELECT)
      .order('id', { ascending: true })
    if (error) {
      console.error('Error fetching accounts:', error)
      return
    }
    setAccounts(data ?? [])
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // Role dropdowns carry a sentinel "+ Create new company…" option. Choosing it
  // opens an inline mini-form for that role instead of selecting an existing id.
  const NEW_COMPANY = '__new__'

  function handleRoleChange(field, value) {
    if (value === NEW_COMPANY) {
      setCreatingRole(field.key)
      setNewCompany({ name: '', type: field.label })
    } else {
      if (creatingRole === field.key) setCreatingRole(null)
      setField(field.key, value)
    }
  }

  function cancelCreateCompany() {
    setCreatingRole(null)
    setNewCompany({ name: '', type: '' })
  }

  // The inline create inputs live inside the account <form>, so a bare Enter
  // would submit the whole account (clearing it). Intercept Enter to create the
  // company instead and keep everything the user already typed.
  function handleNewCompanyKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      createCompanyForRole()
    }
  }

  async function createCompanyForRole() {
    if (!supabase) return
    const role = creatingRole
    const name = newCompany.name.trim()
    if (!name) {
      setStatus({ type: 'error', message: 'New company name is required.' })
      return
    }
    const payload = { Name: name }
    const type = newCompany.type.trim()
    if (type) payload['Company Type'] = type
    const { data, error } = await supabase
      .from('Companies')
      .insert(payload)
      .select()
      .single()
    if (error) {
      console.error('Error creating company:', error)
      setStatus({
        type: 'error',
        message: `Could not add company: ${error.message}`,
      })
      return
    }
    // Add to the shared list (keeping the Name sort fetchCompanies uses) and
    // select the new company for the role that requested it.
    setCompanies((prev) =>
      [...prev, data].sort((a, b) =>
        (a.Name ?? '').localeCompare(b.Name ?? '')
      )
    )
    setField(role, String(data.id))
    setCreatingRole(null)
    setNewCompany({ name: '', type: '' })
    setStatus({ type: 'success', message: `Company “${data.Name}” created.` })
  }

  async function addAccount(e) {
    e.preventDefault()
    if (!supabase) {
      setStatus({ type: 'error', message: 'Not connected to Supabase.' })
      return
    }
    if (!form.usi.trim()) {
      setStatus({ type: 'error', message: 'USI is required.' })
      return
    }
    const payload = {
      usi: form.usi.trim(),
      street_address: form.street_address.trim() || null,
      suburb: form.suburb.trim() || null,
      postcode: form.postcode.trim() || null,
      notes: form.notes.trim() || null,
    }
    for (const f of ROLE_FIELDS) {
      payload[f.key] = form[f.key] ? Number(form[f.key]) : null
    }
    const { data, error } = await supabase
      .from('accounts')
      .insert(payload)
      .select(SELECT)
      .single()
    if (error) {
      console.error('Error adding account:', error)
      setStatus({ type: 'error', message: `Could not save: ${error.message}` })
      return
    }
    setAccounts((prev) => [...prev, data])
    setForm(EMPTY_FORM)
    setStatus({ type: 'success', message: `Account “${data.usi}” added.` })
  }

  function startEdit(account) {
    setEditingId(account.id)
    setEditForm({
      usi: account.usi ?? '',
      street_address: account.street_address ?? '',
      suburb: account.suburb ?? '',
      postcode: account.postcode ?? '',
      notes: account.notes ?? '',
      ...Object.fromEntries(
        ROLE_FIELDS.map((f) => [f.key, account[f.key] ?? ''])
      ),
    })
    setStatus(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(EMPTY_FORM)
  }

  function setEditField(key, value) {
    setEditForm((prev) => ({ ...prev, [key]: value }))
  }

  async function saveEdit(id) {
    if (!supabase) return
    if (!editForm.usi.trim()) {
      setStatus({ type: 'error', message: 'USI is required.' })
      return
    }
    const payload = {
      usi: editForm.usi.trim(),
      street_address: editForm.street_address.trim() || null,
      suburb: editForm.suburb.trim() || null,
      postcode: editForm.postcode.trim() || null,
      notes: editForm.notes.trim() || null,
    }
    for (const f of ROLE_FIELDS) {
      payload[f.key] = editForm[f.key] ? Number(editForm[f.key]) : null
    }
    const { data, error } = await supabase
      .from('accounts')
      .update(payload)
      .eq('id', id)
      .select(SELECT)
    if (error) {
      console.error('Error updating account:', error)
      setStatus({ type: 'error', message: `Could not update: ${error.message}` })
      return
    }
    // An update that returns no rows means the database accepted the request
    // but a Row-Level Security policy blocked the write (no UPDATE policy for
    // the anon key). Surface it instead of showing a false success.
    if (!data || data.length === 0) {
      setStatus({
        type: 'error',
        message:
          'Update was blocked by the database (no row changed). Check the ' +
          'Supabase Row-Level Security UPDATE policy on the accounts table.',
      })
      return
    }
    const updated = data[0]
    setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)))
    setEditingId(null)
    setEditForm(EMPTY_FORM)
    setStatus({ type: 'success', message: `Account “${updated.usi}” updated.` })
  }

  // Show accounts (filtered by the free-form search) sorted alphabetically by
  // the USI's middle "Area" segment. The search matches against the USI,
  // address fields, notes, and every role company name shown in the table.
  const sortedAccounts = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matches = (account) => {
      if (!query) return true
      const haystack = [
        account.usi,
        account.street_address,
        account.suburb,
        account.postcode,
        account.notes,
        ...ROLE_FIELDS.map((f) => account[f.alias]?.Name),
      ]
      return haystack.some(
        (value) => value && String(value).toLowerCase().includes(query)
      )
    }
    return accounts.filter(matches).sort((a, b) =>
      usiArea(a.usi).localeCompare(usiArea(b.usi), undefined, {
        sensitivity: 'base',
      })
    )
  }, [accounts, search])

  return (
    <main className="accounts-page">
      <Link to="/" className="back-link">
        ← Back to home
      </Link>
      <h1>CKO Active Accounts</h1>

      <form className="account-form" onSubmit={addAccount}>
        <label>
          USI (Unique Site Identifier)
          <span className="field-hint">
            Format is Site-Area-Year (e.g. BeachSt5-HUS-26)
          </span>
          <input
            type="text"
            required
            value={form.usi}
            onChange={(e) => setField('usi', e.target.value)}
            placeholder="BeachSt5-HUS-26"
          />
        </label>
        <label>
          Street Address
          <input
            type="text"
            value={form.street_address}
            onChange={(e) => setField('street_address', e.target.value)}
            placeholder="123 Beach St"
          />
        </label>
        <label>
          Suburb
          <input
            type="text"
            value={form.suburb}
            onChange={(e) => setField('suburb', e.target.value)}
            placeholder="Bondi"
          />
        </label>
        <label>
          Postcode
          <input
            type="text"
            value={form.postcode}
            onChange={(e) => setField('postcode', e.target.value)}
            placeholder="2026"
          />
        </label>
        {ROLE_FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            <select
              value={creatingRole === f.key ? NEW_COMPANY : form[f.key]}
              onChange={(e) => handleRoleChange(f, e.target.value)}
            >
              <option value="">Select a company…</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.Name}
                </option>
              ))}
              <option value={NEW_COMPANY}>+ Create new company…</option>
            </select>
            {creatingRole === f.key && (
              <div className="inline-create">
                <input
                  type="text"
                  autoFocus
                  value={newCompany.name}
                  onChange={(e) =>
                    setNewCompany((p) => ({ ...p, name: e.target.value }))
                  }
                  onKeyDown={handleNewCompanyKeyDown}
                  placeholder="New company name"
                />
                <input
                  type="text"
                  value={newCompany.type}
                  onChange={(e) =>
                    setNewCompany((p) => ({ ...p, type: e.target.value }))
                  }
                  onKeyDown={handleNewCompanyKeyDown}
                  placeholder="Company type (optional)"
                />
                <div className="inline-create-actions">
                  <button type="button" onClick={createCompanyForRole}>
                    Add company
                  </button>
                  <button type="button" onClick={cancelCreateCompany}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </label>
        ))}
        <label className="notes-field">
          Notes
          <input
            type="text"
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="Any notes about this account"
          />
        </label>
        <button type="submit">Add Account</button>
        {status && (
          <p className={`form-status ${status.type}`}>{status.message}</p>
        )}
      </form>

      <div className="account-search">
        <label>
          Search accounts
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, USI, suburb, company…"
          />
        </label>
      </div>

      <table className="account-table">
        <thead>
          <tr>
            <th>USI</th>
            <th>Street Address</th>
            <th>Suburb</th>
            <th>Postcode</th>
            {ROLE_FIELDS.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
            <th>Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedAccounts.length === 0 && (
            <tr>
              <td className="empty" colSpan={6 + ROLE_FIELDS.length}>
                {accounts.length === 0
                  ? 'No accounts yet'
                  : 'No accounts match your search'}
              </td>
            </tr>
          )}
          {sortedAccounts.map((account) =>
            editingId === account.id ? (
              <tr key={account.id}>
                <td>
                  <input
                    type="text"
                    value={editForm.usi}
                    onChange={(e) => setEditField('usi', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={editForm.street_address}
                    onChange={(e) =>
                      setEditField('street_address', e.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={editForm.suburb}
                    onChange={(e) => setEditField('suburb', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={editForm.postcode}
                    onChange={(e) => setEditField('postcode', e.target.value)}
                  />
                </td>
                {ROLE_FIELDS.map((f) => (
                  <td key={f.key}>
                    <select
                      value={editForm[f.key]}
                      onChange={(e) => setEditField(f.key, e.target.value)}
                    >
                      <option value="">—</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.Name}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                <td>
                  <input
                    type="text"
                    value={editForm.notes}
                    onChange={(e) => setEditField('notes', e.target.value)}
                  />
                </td>
                <td className="row-actions">
                  <button type="button" onClick={() => saveEdit(account.id)}>
                    Save
                  </button>
                  <button type="button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={account.id}>
                <td>{account.usi}</td>
                <td>{account.street_address ?? '—'}</td>
                <td>{account.suburb ?? '—'}</td>
                <td>{account.postcode ?? '—'}</td>
                {ROLE_FIELDS.map((f) => (
                  <td key={f.key}>{account[f.alias]?.Name ?? '—'}</td>
                ))}
                <td>{account.notes ?? '—'}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => startEdit(account)}>
                    Edit
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </main>
  )
}

export default AccountsPage
