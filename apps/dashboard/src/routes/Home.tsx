import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { Card, EmptyState } from '../ui/Card.js'

// /  — authenticated home. Eventually a Now-Playing-per-location grid;
// today, a placeholder card explaining what will land here.
export function Home() {
  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: T.heading, fontSize: 24, fontWeight: 700,
          color: T.text, letterSpacing: '-0.02em',
        }}>Home</h1>
        <div style={{ color: T.textDim, fontSize: 14, marginTop: 4 }}>
          Now Playing per location.
        </div>
      </div>

      <Card>
        <EmptyState>
          Your floor will show <strong>Now Playing: Mode &middot; Song</strong>
          {' '}here once a player connects. Add a location to get started.
        </EmptyState>
      </Card>
    </Layout>
  )
}
