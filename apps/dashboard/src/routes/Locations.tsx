import { Plus } from 'lucide-react'
import { T } from '../tokens.js'
import { Layout } from '../ui/Layout.js'
import { Card, EmptyState } from '../ui/Card.js'
import { Button } from '../ui/index.js'

// /locations — list of stores under this account. Placeholder list + Add button.
export function Locations() {
  return (
    <Layout>
      <div style={{
        marginBottom: 24, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{
            fontFamily: T.heading, fontSize: 24, fontWeight: 700,
            color: T.text, letterSpacing: '-0.02em',
          }}>Locations</h1>
          <div style={{ color: T.textDim, fontSize: 14, marginTop: 4 }}>
            Each location streams its own music feed.
          </div>
        </div>
        <Button>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} strokeWidth={2} /> Add location
          </span>
        </Button>
      </div>

      <Card>
        <EmptyState>
          No locations yet. Add your first one and we will provision a player URL
          you can open on any in-store device.
        </EmptyState>
      </Card>
    </Layout>
  )
}
