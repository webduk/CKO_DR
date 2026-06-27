import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import supabase from './supabase-client'

const EMPTY_CONTACT = { name: '', email: '', phone: '', title: '' }

function ContactsPage() {
  const [companies, setCompanies] = useState([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [contacts, setContacts] = useState([])
  const [newContact, setNewContact] = useState(EMPTY_CONTACT)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    fetchCompanies()
  }, [])

  useEffect(() => {
    setStatus(null)
    if (selectedCompanyId) {
      fetchContacts(selectedCompanyId)
    } else {
      setContacts([])
    }
  }, [selectedCompanyId])

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

  async function fetchContacts(companyId) {
    if (!supabase) return
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('company_id', companyId)
      .order('id', { ascending: true })
    if (error) {
      console.error('Error fetching contacts:', error)
      return
    }
    setContacts(data ?? [])
  }

  async function addContact(e) {
    e.preventDefault()
    if (!supabase || !selectedCompanyId) {
      setStatus({ type: 'error', message: 'Select a company first.' })
      return
    }
    if (!newContact.name.trim()) {
      setStatus({ type: 'error', message: 'Contact name is required.' })
      return
    }
    const payload = {
      company_id: Number(selectedCompanyId),
      name: newContact.name.trim(),
      email: newContact.email.trim() || null,
      phone: newContact.phone.trim() || null,
      title: newContact.title.trim() || null,
    }
    const { data, error } = await supabase
      .from('contacts')
      .insert(payload)
      .select()
      .single()
    if (error) {
      console.error('Error adding contact:', error)
      setStatus({ type: 'error', message: `Could not add: ${error.message}` })
      return
    }
    setContacts((prev) => [...prev, data])
    setNewContact(EMPTY_CONTACT)
    setStatus({ type: 'success', message: `Contact “${data.name}” added.` })
  }

  // Edit existing contacts in place; `editField` updates local state,
  // `saveContact` persists the row to Supabase.
  function editField(id, field, value) {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    )
  }

  async function saveContact(contact) {
    if (!supabase) return
    const { error } = await supabase
      .from('contacts')
      .update({
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        title: contact.title,
      })
      .eq('id', contact.id)
    if (error) {
      console.error('Error updating contact:', error)
      return
    }
  }

  async function deleteContact(id) {
    if (!supabase) return
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) {
      console.error('Error deleting contact:', error)
      return
    }
    setContacts((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <main className="contacts-page">
      <Link to="/" className="back-link">
        ← Back to home
      </Link>
      <h1>Company Contacts</h1>

      <label className="company-picker">
        Company
        <select
          value={selectedCompanyId}
          onChange={(e) => setSelectedCompanyId(e.target.value)}
        >
          <option value="">Select a company…</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.Name}
            </option>
          ))}
        </select>
      </label>

      {selectedCompanyId && (
        <>
          <form className="contact-form" onSubmit={addContact}>
            <h2>Add a contact</h2>
            <input
              type="text"
              value={newContact.name}
              onChange={(e) =>
                setNewContact((p) => ({ ...p, name: e.target.value }))
              }
              placeholder="Name"
            />
            <input
              type="email"
              value={newContact.email}
              onChange={(e) =>
                setNewContact((p) => ({ ...p, email: e.target.value }))
              }
              placeholder="Email"
            />
            <input
              type="text"
              value={newContact.phone}
              onChange={(e) =>
                setNewContact((p) => ({ ...p, phone: e.target.value }))
              }
              placeholder="Phone"
            />
            <input
              type="text"
              value={newContact.title}
              onChange={(e) =>
                setNewContact((p) => ({ ...p, title: e.target.value }))
              }
              placeholder="Title"
            />
            <button type="submit">Add Contact</button>
            {status && (
              <p className={`form-status ${status.type}`}>{status.message}</p>
            )}
          </form>

          <h2 className="contacts-table-heading">Existing contacts</h2>
          <table className="contacts-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Title</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 && (
                <tr>
                  <td className="empty" colSpan={5}>
                    No contacts for this company yet
                  </td>
                </tr>
              )}
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <input
                      type="text"
                      value={contact.name ?? ''}
                      onChange={(e) =>
                        editField(contact.id, 'name', e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="email"
                      value={contact.email ?? ''}
                      onChange={(e) =>
                        editField(contact.id, 'email', e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={contact.phone ?? ''}
                      onChange={(e) =>
                        editField(contact.id, 'phone', e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={contact.title ?? ''}
                      onChange={(e) =>
                        editField(contact.id, 'title', e.target.value)
                      }
                    />
                  </td>
                  <td className="row-actions">
                    <button type="button" onClick={() => saveContact(contact)}>
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteContact(contact.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  )
}

export default ContactsPage
