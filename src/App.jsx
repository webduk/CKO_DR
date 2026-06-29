import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import './App.css'
import supabase from './supabase-client';

function App() {
  const [todos, setTodos] = useState([])
  const [newTodo, setNewTodo] = useState('')
  const [designRequestCount, setDesignRequestCount] = useState(null)

  async function fetchDesignRequestCount() {
    if (!supabase) return
    const { count, error } = await supabase
      .from('design_requests')
      .select('*', { count: 'exact', head: true })
    if (error) {
      console.error('Error counting design requests:', error)
      return
    }
    setDesignRequestCount(count ?? 0)
  }

  async function fetchTodos() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .order('id', { ascending: true })
    if (error) {
      console.error('Error fetching todos:', error)
      return
    }
    setTodos(data ?? [])
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after await, not synchronously
    fetchTodos()
    fetchDesignRequestCount()
  }, [])

  async function addTodo(e) {
    e.preventDefault()
    const title = newTodo.trim()
    if (!title || !supabase) return
    const { data, error } = await supabase
      .from('todos')
      .insert({ title })
      .select()
      .single()
    if (error) {
      console.error('Error adding todo:', error)
      return
    }
    setTodos((prev) => [...prev, data])
    setNewTodo('')
  }

  async function deleteTodo(id) {
    if (!supabase) return
    const { error } = await supabase.from('todos').delete().eq('id', id)
    if (error) {
      console.error('Error deleting todo:', error)
      return
    }
    setTodos((prev) => prev.filter((todo) => todo.id !== id))
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <>
      <div className="home-date">{today}</div>

      <section id="center">
        <div>
          <h1>CKO</h1>
        </div>
        <nav className="nav-buttons">
          <Link to="/accounts/new" className="nav-button">
            Add CKO Account
          </Link>
          <Link to="/contacts" className="nav-button">
            Manage Contacts
          </Link>
          <Link to="/accounts/map" className="nav-button">
            Account Map
          </Link>
          <Link to="/accounts/report" className="nav-button">
            Accounts Report
          </Link>
          <Link to="/companies" className="nav-button">
            Manage Companies
          </Link>
          <Link to="/design-requests" className="nav-button">
            Design Requests
          </Link>
        </nav>

        <Link to="/design-requests" className="stat-widget">
          <span className="stat-number">
            {designRequestCount ?? '—'}
          </span>
          <span className="stat-label">Active Design Requests</span>
        </Link>
      </section>

      <div className="ticks"></div>

      <section id="supabase">
        <h1>Todo List</h1>
        <form className="todo-form" onSubmit={addTodo}>
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            placeholder="What needs to be done?"
          />
          <button type="submit">Add</button>
        </form>
        <ul className="todo-list">
          {todos.length === 0 && <li className="empty">No todos yet</li>}
          {todos.map((todo) => (
            <li key={todo.id}>
              <span>{todo.title}</span>
              <button type="button" onClick={() => deleteTodo(todo.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>

        <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img className="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://react.dev/" target="_blank">
                <img className="button-icon" src={reactLogo} alt="" />
                Learn more
              </a>
            </li>
          </ul>
        </div>
        <div id="social">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#social-icon"></use>
          </svg>
          <h2>Connect with us</h2>
          <p>Join the Vite community</p>
          <ul>
            <li>
              <a href="https://github.com/vitejs/vite" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#github-icon"></use>
                </svg>
                GitHub
              </a>
            </li>
            <li>
              <a href="https://chat.vite.dev/" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#discord-icon"></use>
                </svg>
                Discord
              </a>
            </li>
            <li>
              <a href="https://x.com/vite_js" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#x-icon"></use>
                </svg>
                X.com
              </a>
            </li>
            <li>
              <a href="https://bsky.app/profile/vite.dev" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#bluesky-icon"></use>
                </svg>
                Bluesky
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

export default App
