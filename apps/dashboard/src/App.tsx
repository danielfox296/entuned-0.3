import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
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
import { Upgrade } from './routes/Upgrade.js'
import { OnboardProfile } from './routes/OnboardProfile.js'
import { BoostTrial } from './routes/BoostTrial.js'
import { ReferralLanding } from './routes/ReferralLanding.js'
import { trackPageView } from './lib/ga4.js'

// SPA virtual pageview — fires on every React Router transition so GA4
// picks up in-app navigation that wouldn't trigger a full page load.
function GA4PageTracker() {
  const { pathname } = useLocation()
  useEffect(() => { trackPageView(pathname) }, [pathname])
  return null
}

// Top-level route table for the customer dashboard.
//
// Public:    /start, /welcome
// Auth gate: everything else, behind <RequireAuth>
export function App() {
  return (
    <BrowserRouter>
      <GA4PageTracker />
      <Routes>
        {/* Public routes */}
        <Route path="/start"   element={<Start />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/r/:code" element={<ReferralLanding />} />

        {/* Onboarding gate — server redirects here when industry === null */}
        <Route path="/onboard"      element={<RequireAuth><OnboardProfile /></RequireAuth>} />
        <Route path="/boost-trial"  element={<RequireAuth><BoostTrial /></RequireAuth>} />

        {/* Authenticated app */}
        <Route path="/"             element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/locations"    element={<RequireAuth><Locations /></RequireAuth>} />
        <Route path="/intake"       element={<RequireAuth><IcpIntake /></RequireAuth>} />
        <Route path="/schedule"     element={<RequireAuth><Schedule /></RequireAuth>} />
        <Route path="/integrations" element={<RequireAuth><Integrations /></RequireAuth>} />
        <Route path="/reports"      element={<RequireAuth><Reports /></RequireAuth>} />
        <Route path="/account"      element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="/upgrade"      element={<RequireAuth><Upgrade /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  )
}
