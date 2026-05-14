// GA4 event helpers for the dashboard app (app.entuned.co).
//
// All events use the global `gtag` function injected in index.html.
// Safe to import even if the snippet hasn't loaded — every call
// guards on `typeof gtag`.

declare global {
  // eslint-disable-next-line no-var
  var gtag: ((...args: unknown[]) => void) | undefined
}

function fire(event: string, params?: Record<string, unknown>) {
  if (typeof gtag === 'function') gtag('event', event, params)
}

// ── Landing ─────────────────────────────────────────────────────────
// Fires once per page-load when the /start route renders.
let landingFired = false
export function trackDashboardLanding() {
  if (landingFired) return
  landingFired = true
  fire('dashboard_landing')
}

// ── Sign-up ─────────────────────────────────────────────────────────
// Fires when a user submits the magic-link form or clicks Google OAuth.
export function trackSignUp(method: 'magic_link' | 'google') {
  fire('dashboard_signup', { method })
}

// ── Onboarding complete ─────────────────────────────────────────────
// Fires when the user's Stripe checkout is confirmed and they land
// on the Welcome → Intake flow (account provisioned).
export function trackOnboardingComplete() {
  fire('dashboard_onboarding_complete')
}

// ── Route change (virtual pageview) ─────────────────────────────────
// GA4 auto-tracks page_view for full navigations, but the dashboard
// is a SPA. Fire a manual page_view on each React Router transition.
export function trackPageView(path: string) {
  fire('page_view', { page_path: path })
}

// ── Locked nav click ─────────────────────────────────────────────────
// Fires when a user clicks a nav item their tier doesn't unlock.
export function trackLockedNavClick(feature: string, requiredTier: string) {
  fire('locked_nav_click', { feature, required_tier: requiredTier })
}

// ── Upgrade CTA click ────────────────────────────────────────────────
// Fires when any upgrade CTA is clicked. source identifies where:
//   'home_card' | 'feature_page_customer_profile' | 'feature_page_schedule' | 'feature_page_integrations'
export function trackUpgradeCtaClick(source: string, targetTier: string) {
  fire('upgrade_cta_click', { source, target_tier: targetTier })
}

// ── Feature page view ────────────────────────────────────────────────
// Fires once per visit to a feature route, after tier is resolved.
// locked=true means the user's tier doesn't include this feature.
export function trackFeaturePageView(feature: string, locked: boolean) {
  fire('feature_page_view', { feature, locked })
}

// ── Boost Trial funnel ────────────────────────────────────────────────
export function trackBoostTrialStarted() {
  fire('boost_trial_started')
}

export function trackBoostTrialQuestionAnswered(qNum: number, qId: string, value: string) {
  fire(`boost_trial_q${qNum}_answered`, { question_id: qId, value })
}

export function trackBoostTrialCompleted() {
  fire('boost_trial_completed')
}

// ── Referral ──────────────────────────────────────────────────────────
export function trackReferralCodeGenerated() {
  fire('referral_code_generated')
}

export function trackReferralShared(method: 'copy' | 'share') {
  fire('referral_shared', { method })
}

// ── Post-conversion benchmarking ──────────────────────────────────────
export function trackBenchmarkingCompleted() {
  fire('benchmarking_completed')
}
