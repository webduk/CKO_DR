import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import AccountsPage from './AccountsPage.jsx'
import ContactsPage from './ContactsPage.jsx'
import MapPage from './MapPage.jsx'
import AccountsReportPage from './AccountsReportPage.jsx'
import CompaniesPage from './CompaniesPage.jsx'
import DesignRequestsPage from './DesignRequestsPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/accounts/new" element={<AccountsPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/accounts/map" element={<MapPage />} />
        <Route path="/accounts/report" element={<AccountsReportPage />} />
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/design-requests" element={<DesignRequestsPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
