import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { RequireAuth } from './lib/auth.jsx'
import { Start } from './routes/Start.js'
import { Welcome } from './routes/Welcome.js'
import { Home } from './routes/Home.js'
import { IcpIntake } from './routes/IcpIntake.js'
import { Account } from './routes/Account.js'
import { Locations } from './routes/Locations.js'

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

        <Route path="/"          element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/intake"    element={<RequireAuth><IcpIntake /></RequireAuth>} />
        <Route path="/locations" element={<RequireAuth><Locations /></RequireAuth>} />
        <Route path="/account"   element={<RequireAuth><Account /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  )
}
