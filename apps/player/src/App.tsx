export function App() {
  return (
    <div style={{
      fontFamily: 'system-ui, sans-serif',
      padding: '2rem',
      maxWidth: 640,
      margin: '0 auto',
      lineHeight: 1.6,
    }}>
      <h1 style={{ marginBottom: '0.25rem' }}>entuned · player</h1>
      <p style={{ color: '#888', marginTop: 0 }}>v0.3 · Phase 0 scaffold</p>
      <p>
        This is the in-store player. Phase 0 will:
      </p>
      <ul>
        <li>Pull a 3-song queue from <code>/hendrix/next</code></li>
        <li>Play audio (Howler) from R2</li>
        <li>Emit <code>song_start</code> / <code>song_complete</code> / <code>song_skip</code> to <code>/events</code></li>
        <li>Refill at queue depth 1</li>
      </ul>
    </div>
  )
}
