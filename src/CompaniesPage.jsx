import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import supabase from './supabase-client'

function CompaniesPage() {
  const [companies, setCompanies] = useState([])
  const [companyName, setCompanyName] = useState('')
  const [companyType, setCompanyType] = useState('')
  const [typeQuery, setTypeQuery] = useState('')
  const [status, setStatus] = useState(null)
  // `editingId` is the company row in edit mode (null = none); `editForm`
  // holds its in-progress values until saved or cancelled.
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', type: '' })

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
    setCompanies(data ?? [])
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after await, not synchronously
    fetchCompanies()
  }, [])

  async function addCompany(e) {
    e.preventDefault()
    if (!supabase) return
    const name = companyName.trim()
    const type = companyType.trim()
    if (!name) {
      setStatus({ type: 'error', message: 'Company name is required.' })
      return
    }
    const { data, error } = await supabase
      .from('Companies')
      .insert({ Name: name, 'Company Type': type || null })
      .select()
      .single()
    if (error) {
      console.error('Error adding company:', error)
      setStatus({ type: 'error', message: `Could not add: ${error.message}` })
      return
    }
    // Keep the list alphabetical so the new company lands in the right spot.
    setCompanies((prev) =>
      [...prev, data].sort((a, b) =>
        (a.Name ?? '').localeCompare(b.Name ?? '', undefined, {
          sensitivity: 'base',
        })
      )
    )
    setCompanyName('')
    setCompanyType('')
    setStatus({ type: 'success', message: `Company “${data.Name}” added.` })
  }

  function sortByName(list) {
    return [...list].sort((a, b) =>
      (a.Name ?? '').localeCompare(b.Name ?? '', undefined, {
        sensitivity: 'base',
      })
    )
  }

  function startEdit(company) {
    setEditingId(company.id)
    setEditForm({ name: company.Name ?? '', type: company['Company Type'] ?? '' })
    setStatus(null)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id) {
    if (!supabase) return
    const name = editForm.name.trim()
    if (!name) {
      setStatus({ type: 'error', message: 'Company name is required.' })
      return
    }
    const { data, error } = await supabase
      .from('Companies')
      .update({ Name: name, 'Company Type': editForm.type.trim() || null })
      .eq('id', id)
      .select()
    if (error) {
      console.error('Error updating company:', error)
      setStatus({ type: 'error', message: `Could not update: ${error.message}` })
      return
    }
    // No rows returned means an RLS policy blocked the write.
    if (!data || data.length === 0) {
      setStatus({
        type: 'error',
        message:
          'Update was blocked by the database (no row changed). Add a ' +
          'Row-Level Security UPDATE policy on the Companies table.',
      })
      return
    }
    setCompanies((prev) => sortByName(prev.map((c) => (c.id === id ? data[0] : c))))
    setEditingId(null)
    setStatus({ type: 'success', message: `Company “${data[0].Name}” updated.` })
  }

  async function deleteCompany(company) {
    if (!supabase) return
    if (
      !window.confirm(
        `Delete “${company.Name}”? This can't be undone.`
      )
    ) {
      return
    }
    const { data, error } = await supabase
      .from('Companies')
      .delete()
      .eq('id', company.id)
      .select()
    if (error) {
      console.error('Error deleting company:', error)
      // A foreign-key violation means the company is still linked to accounts,
      // contacts or design requests.
      setStatus({
        type: 'error',
        message: `Could not delete: ${error.message}`,
      })
      return
    }
    if (!data || data.length === 0) {
      setStatus({
        type: 'error',
        message:
          'Delete was blocked by the database (no row removed). Add a ' +
          'Row-Level Security DELETE policy on the Companies table.',
      })
      return
    }
    setCompanies((prev) => prev.filter((c) => c.id !== company.id))
    if (editingId === company.id) setEditingId(null)
    setStatus({ type: 'success', message: `Company “${company.Name}” deleted.` })
  }

  // Filter the table by Company Type, case-insensitive.
  const filtered = useMemo(() => {
    const q = typeQuery.trim().toLowerCase()
    if (!q) return companies
    return companies.filter((c) =>
      (c['Company Type'] ?? '').toLowerCase().includes(q)
    )
  }, [companies, typeQuery])

  return (
    <main className="companies-page">
      <Link to="/" className="back-link">
        ← Back to home
      </Link>
      <h1>Companies</h1>

      <form className="company-form" onSubmit={addCompany}>
        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Name"
        />
        <input
          type="text"
          value={companyType}
          onChange={(e) => setCompanyType(e.target.value)}
          placeholder="Company Type"
        />
        <button type="submit">Add</button>
        {status && (
          <p className={`form-status ${status.type}`}>{status.message}</p>
        )}
      </form>

      <input
        type="search"
        className="company-search"
        value={typeQuery}
        onChange={(e) => setTypeQuery(e.target.value)}
        placeholder="Search by company type…"
      />

      <table className="company-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Company Type</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td className="empty" colSpan={3}>
                {companies.length === 0
                  ? 'No companies yet'
                  : `No companies match “${typeQuery}”`}
              </td>
            </tr>
          )}
          {filtered.map((company) =>
            editingId === company.id ? (
              <tr key={company.id}>
                <td>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={editForm.type}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, type: e.target.value }))
                    }
                  />
                </td>
                <td className="row-actions">
                  <button type="button" onClick={() => saveEdit(company.id)}>
                    Save
                  </button>
                  <button type="button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={company.id}>
                <td>{company.Name}</td>
                <td>{company['Company Type']}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => startEdit(company)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => deleteCompany(company)}>
                    Delete
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

export default CompaniesPage
