import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { RequireAuth } from './lib/auth.jsx'
import { Start } from './routes/Start.js'
import { Welcome } from './routes/Welcome.js'
import { Home } from './routes/Home.js'
import { IcpIntake } from './routes/IcpIntake.js'
import { Account } from './routes/Account.js'
import { Locations } from './routes/Locations.js'
import { Schedule } from './routes/Schedule.js'
import { Integrations } from './routes/Integrations.js'
import { Reports } from './routes/Reports.js'

// Top-level route table for the customer dashboard.
//
// Public:    /start, /welcome
// Auth gate: everything else, behind <RequireAuth>
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/start"   element={<Start />} />
        <Route path="/welcome" element={<Welcome />} />

        <Route path="/"             element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/locations"    element={<RequireAuth><Locations /></RequireAuth>} />
        <Route path="/intake"       element={<RequireAuth><IcpIntake /></RequireAuth>} />
        <Route path="/schedule"     element={<RequireAuth><Schedule /></RequireAuth>} />
        <Route path="/integrations" element={<RequireAuth><Integrations /></RequireAuth>} />
        <Route path="/reports"      element={<RequireAuth><Reports /></RequireAuth>} />
        <Route path="/account"      element={<RequireAuth><Account /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  )
}
