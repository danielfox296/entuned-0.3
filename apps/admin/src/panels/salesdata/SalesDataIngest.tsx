import { useEffect, useRef, useState } from 'react'
import { api, getToken } from '../../api.js'
import type { StoreSummary } from '../../api.js'
import { T } from '../../tokens.js'
import { S } from '../../ui/sizes.js'
import { Button, StorePicker } from '../../ui/index.js'

// ── CSV parsing ──────────────────────────────────────────────────

// Column normalisation — tolerant of common POS export headers
const COL: Record<string, string> = {
  // timestamp variants
  timestamp: 'occurredAt', datetime: 'occurredAt', date_time: 'occurredAt',
  transaction_date: 'occurredAt', transaction_time: 'occurredAt',
  occurred_at: 'occurredAt', time: 'occurredAt', date: 'date',
  // amount variants
  amount: 'amount', total: 'amount', transaction_value: 'amount',
  transaction_amount: 'amount', revenue: 'amount', sale_total: 'amount',
  net_sales: 'amount', gross_sales: 'amount',
  // item count variants
  item_count: 'itemCount', items: 'itemCount', units: 'itemCount',
  quantity: 'itemCount', qty: 'itemCount', unit_count: 'itemCount',
  // external id
  transaction_id: 'posExternalId', id: 'posExternalId',
  pos_external_id: 'posExternalId', receipt_number: 'posExternalId',
  // separate date/time columns (merged downstream)
  currency: 'currency',
}

interface ParsedRow {
  occurredAt: string       // ISO string (best-effort)
  transactionValueCents: number
  currency: string
  itemCount: number
  posExternalId?: string
  _raw: Record<string, string>
  _error?: string
}

function parseCsvText(text: string): { rows: ParsedRow[]; parseErrors: number } {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { rows: [], parseErrors: 0 }

  const rawHeaders = lines[0].split(',').map((h) => h.replace(/^["']|["']$/g, '').trim())
  const normHeaders = rawHeaders.map((h) => COL[h.toLowerCase().replace(/\s+/g, '_')] ?? h.toLowerCase())

  const rows: ParsedRow[] = []
  let parseErrors = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Basic CSV split (handles quoted fields with commas)
    const values: string[] = []
    let cur = ''
    let inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue }
      if (ch === ',' && !inQuote) { values.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    values.push(cur.trim())

    const raw: Record<string, string> = {}
    normHeaders.forEach((h, idx) => { raw[h] = values[idx] ?? '' })

    // Build timestamp: prefer occurredAt column, else merge date + time columns
    let occurredAt = raw['occurredAt'] ?? ''
    if (!occurredAt && raw['date']) {
      occurredAt = raw['date']
      if (raw['time']) occurredAt += ' ' + raw['time']
    }

    // Normalise timestamp to ISO
    let isoTs = ''
    if (occurredAt) {
      try {
        const d = new Date(occurredAt)
        if (!isNaN(d.getTime())) isoTs = d.toISOString()
      } catch { /* fall through */ }
    }

    // Parse amount — strip currency symbols, handle negative (refunds)
    const amountRaw = (raw['amount'] ?? '0').replace(/[$,€£¥]/g, '').trim()
    const amountFloat = parseFloat(amountRaw)
    const valueCents = isNaN(amountFloat) ? 0 : Math.round(Math.abs(amountFloat) * 100)

    const itemCount = parseInt(raw['itemCount'] ?? '1', 10)

    const row: ParsedRow = {
      occurredAt: isoTs,
      transactionValueCents: valueCents,
      currency: raw['currency'] ?? 'USD',
      itemCount: isNaN(itemCount) || itemCount < 0 ? 1 : itemCount,
      posExternalId: raw['posExternalId'] || undefined,
      _raw: raw,
    }

    if (!isoTs) {
      row._error = 'Could not parse timestamp'
      parseErrors++
    }

    rows.push(row)
  }

  return { rows, parseErrors: parseErrors }
}


// ── Sub-components ───────────────────────────────────────────────

function StatBox({ label, value, dim }: { label: string; value: string | number; dim?: boolean }) {
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.border}`,
      borderRadius: S.r6, padding: '14px 18px',
    }}>
      <div style={{ fontSize: S.label, color: T.textFaint, fontFamily: T.sans, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: T.heading, fontWeight: 600, color: dim ? T.textDim : T.text }}>{value}</div>
    </div>
  )
}

function RunRow({ run }: { run: PullRunRow }) {
  const statusColor = run.status === 'success' ? T.success : run.status === 'failed' ? T.danger : T.warn
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 80px 90px 100px 100px',
      gap: 12, padding: '10px 14px', alignItems: 'center',
      borderBottom: `1px solid ${T.borderSubtle}`,
      fontSize: S.small, fontFamily: T.sans,
    }}>
      <span style={{ color: T.textDim }}>{new Date(run.startedAt).toLocaleString()}</span>
      <span style={{ color: T.textMuted }}>{run.posProvider}</span>
      <span style={{ color: run.eventsIngested ? T.text : T.textFaint }}>{run.eventsIngested ?? 0} rows</span>
      <span style={{ color: T.textFaint }}>{run.triggeredBy}</span>
      <span style={{
        fontWeight: 500, fontSize: S.label, textTransform: 'uppercase', letterSpacing: '0.05em',
        color: statusColor,
      }}>{run.status}</span>
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────

type Step = 'pick' | 'upload' | 'preview' | 'done'

interface IngestResult { runId: string; ingested: number; skipped: number; errors: string[] }

interface PullRunRow {
  id: string; posProvider: string; pullWindowStart: string; pullWindowEnd: string
  startedAt: string; finishedAt: string | null; status: string
  eventsIngested: number | null; triggeredBy: string
}

export function SalesDataIngest() {
  const fileRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const [stores, setStores] = useState<StoreSummary[] | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('pick')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [parseErrors, setParseErrors] = useState(0)
  const [provider, setProvider] = useState('manual_csv')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [runs, setRuns] = useState<PullRunRow[] | null>(null)
  const [summary, setSummary] = useState<{ totalEvents: number; earliestAt: string | null; latestAt: string | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const token = getToken(); if (!token) return
    api.stores(token).then(setStores).catch(() => {})
  }, [])

  useEffect(() => {
    if (!storeId) return
    const token = getToken(); if (!token) return
    Promise.all([
      api.posRuns(storeId, token),
      api.posSummary(storeId, token),
    ]).then(([r, s]) => { setRuns(r); setSummary(s) }).catch(() => {})
  }, [storeId, result])

  // Jump to upload step once a store is picked
  const onStorePick = (id: string) => {
    setStoreId(id)
    setStep('upload')
  }

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { rows: parsed, parseErrors: errs } = parseCsvText(text)
      setRows(parsed)
      setParseErrors(errs)
      setStep('preview')
    }
    reader.readAsText(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function submit() {
    if (!storeId) return
    const token = getToken(); if (!token) return
    setBusy(true)
    setErr(null)
    try {
      const validRows = rows.filter((r) => !r._error)
      const dates = validRows.map((r) => new Date(r.occurredAt)).filter((d) => !isNaN(d.getTime()))
      const pullStart = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString() : new Date().toISOString()
      const pullEnd = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : new Date().toISOString()

      const res = await api.posIngest(storeId, {
        posProvider: provider,
        pullWindowStart: pullStart,
        pullWindowEnd: pullEnd,
        events: validRows.map((r) => ({
          occurredAt: r.occurredAt,
          transactionValueCents: r.transactionValueCents,
          currency: r.currency,
          itemCount: r.itemCount,
          posExternalId: r.posExternalId,
        })),
      }, token)
      setResult(res)
      setStep('done')
    } catch (e: any) {
      setErr(e.message ?? 'Ingest failed')
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setRows([]); setParseErrors(0)
    setResult(null); setErr(null)
    setStep(storeId ? 'upload' : 'pick')
  }

  const validRows = rows.filter((r) => !r._error)
  const totalValueDollars = validRows.reduce((s, r) => s + r.transactionValueCents / 100, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.xxl }}>

      {/* Store picker (always visible) */}
      <div>
        <div style={{ fontSize: S.label, color: T.textFaint, fontFamily: T.sans, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: S.sm }}>Location</div>
        <StorePicker stores={stores} storeId={storeId} onPick={onStorePick} />
      </div>

      {/* Summary stats for selected store */}
      {storeId && summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: S.md }}>
          <StatBox label="Total transactions" value={summary.totalEvents.toLocaleString()} dim={summary.totalEvents === 0} />
          <StatBox label="Earliest record" value={summary.earliestAt ? new Date(summary.earliestAt).toLocaleDateString() : '—'} dim={!summary.earliestAt} />
          <StatBox label="Latest record" value={summary.latestAt ? new Date(summary.latestAt).toLocaleDateString() : '—'} dim={!summary.latestAt} />
        </div>
      )}

      {/* Step: upload */}
      {step === 'upload' && storeId && (
        <div>
          <div style={{ fontSize: S.subhead, fontFamily: T.heading, fontWeight: 600, color: T.text, marginBottom: S.md }}>Upload CSV</div>

          <div style={{ marginBottom: S.lg }}>
            <label style={{ fontSize: S.label, color: T.textFaint, fontFamily: T.sans, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: S.xs }}>POS System</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              style={{
                background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: S.r4,
                color: T.text, fontFamily: T.sans, fontSize: S.small,
                padding: '8px 12px', width: 240,
              }}
            >
              <option value="manual_csv">Manual CSV</option>
              <option value="square">Square</option>
              <option value="stripe">Stripe</option>
              <option value="clover">Clover</option>
              <option value="toast">Toast</option>
              <option value="lightspeed">Lightspeed</option>
              <option value="shopify">Shopify POS</option>
            </select>
          </div>

          <div
            ref={dropRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${T.border}`, borderRadius: S.r6,
              padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
              background: T.surfaceRaised,
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: S.body, color: T.textMuted, fontFamily: T.sans, marginBottom: S.sm }}>Drop a CSV file here or click to browse</div>
            <div style={{ fontSize: S.small, color: T.textFaint, fontFamily: T.sans, marginBottom: S.lg, lineHeight: 1.6 }}>
              Required columns: <code style={{ color: T.accent }}>timestamp</code> (or <code style={{ color: T.accent }}>date</code> + <code style={{ color: T.accent }}>time</code>), <code style={{ color: T.accent }}>amount</code>
              <br />
              Optional: <code style={{ color: T.textDim }}>item_count</code>, <code style={{ color: T.textDim }}>transaction_id</code>, <code style={{ color: T.textDim }}>currency</code>
            </div>
            <Button variant="ghost" onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}>Browse File</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>
        </div>
      )}

      {/* Step: preview */}
      {step === 'preview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: S.lg }}>
            <div style={{ fontSize: S.subhead, fontFamily: T.heading, fontWeight: 600, color: T.text }}>Preview</div>
            <div style={{ flex: 1 }} />
            <Button variant="ghost" onClick={reset}>← Back</Button>
            <Button
              onClick={submit}
              disabled={busy || validRows.length === 0}
            >
              {busy ? 'Ingesting…' : `Import ${validRows.length.toLocaleString()} rows`}
            </Button>
          </div>

          {/* Parse summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: S.md }}>
            <StatBox label="Valid rows" value={validRows.length.toLocaleString()} />
            <StatBox label="Parse errors" value={parseErrors} dim={parseErrors === 0} />
            <StatBox label="Total value" value={`$${totalValueDollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            <StatBox label="Avg items / txn" value={validRows.length ? (validRows.reduce((s, r) => s + r.itemCount, 0) / validRows.length).toFixed(1) : '—'} dim={validRows.length === 0} />
          </div>

          {parseErrors > 0 && (
            <div style={{
              background: `${T.danger}18`, border: `1px solid ${T.danger}44`,
              borderRadius: S.r4, padding: '10px 14px',
              fontSize: S.small, color: T.danger, fontFamily: T.sans,
            }}>
              {parseErrors} row{parseErrors !== 1 ? 's' : ''} could not be parsed (missing or invalid timestamp) and will be skipped.
            </div>
          )}

          {err && (
            <div style={{
              background: `${T.danger}18`, border: `1px solid ${T.danger}44`,
              borderRadius: S.r4, padding: '10px 14px',
              fontSize: S.small, color: T.danger, fontFamily: T.sans,
            }}>{err}</div>
          )}

          {/* Preview table — first 50 rows */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: S.small, fontFamily: T.sans }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Timestamp</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Items</th>
                  <th style={thStyle}>Currency</th>
                  <th style={thStyle}>External ID</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.borderSubtle}`, opacity: row._error ? 0.45 : 1 }}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={{ ...tdStyle, color: row._error ? T.danger : T.textMuted }}>{row.occurredAt ? new Date(row.occurredAt).toLocaleString() : <em>—</em>}</td>
                    <td style={tdStyle}>${(row.transactionValueCents / 100).toFixed(2)}</td>
                    <td style={tdStyle}>{row.itemCount}</td>
                    <td style={{ ...tdStyle, color: T.textFaint }}>{row.currency}</td>
                    <td style={{ ...tdStyle, color: T.textFaint, fontFamily: "'Inter', monospace", fontSize: 12 }}>{row.posExternalId ?? '—'}</td>
                    <td style={{ ...tdStyle, color: row._error ? T.danger : T.success, fontSize: S.label, fontWeight: 500 }}>
                      {row._error ?? 'ok'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 50 && (
              <div style={{ padding: '8px 14px', fontSize: S.small, color: T.textFaint, fontFamily: T.sans }}>
                …and {(rows.length - 50).toLocaleString()} more rows
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step: done */}
      {step === 'done' && result && (
        <div style={{
          background: T.surfaceRaised, border: `1px solid ${T.border}`,
          borderRadius: S.r6, padding: S.xxl,
        }}>
          <div style={{ fontSize: S.subhead, fontFamily: T.heading, fontWeight: 600, color: T.text, marginBottom: S.lg }}>Import complete</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto) 1fr', gap: S.xxl, marginBottom: S.lg, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 32, fontFamily: T.heading, fontWeight: 700, color: T.success }}>{result.ingested.toLocaleString()}</div>
              <div style={{ fontSize: S.small, color: T.textFaint, fontFamily: T.sans, marginTop: 4 }}>ingested</div>
            </div>
            {result.skipped > 0 && (
              <div>
                <div style={{ fontSize: 32, fontFamily: T.heading, fontWeight: 700, color: T.warn }}>{result.skipped.toLocaleString()}</div>
                <div style={{ fontSize: S.small, color: T.textFaint, fontFamily: T.sans, marginTop: 4 }}>skipped (duplicates)</div>
              </div>
            )}
            {result.errors.length > 0 && (
              <div>
                <div style={{ fontSize: 32, fontFamily: T.heading, fontWeight: 700, color: T.danger }}>{result.errors.length}</div>
                <div style={{ fontSize: S.small, color: T.textFaint, fontFamily: T.sans, marginTop: 4 }}>errors</div>
              </div>
            )}
            <div />
          </div>
          {result.errors.length > 0 && (
            <div style={{ marginBottom: S.lg }}>
              <div style={{ fontSize: S.label, color: T.textFaint, fontFamily: T.sans, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: S.xs }}>Errors</div>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: S.small, color: T.danger, fontFamily: T.sans }}>{e}</div>
              ))}
            </div>
          )}
          <Button variant="ghost" onClick={reset}>Upload another file</Button>
        </div>
      )}

      {/* Pull run history */}
      {storeId && runs && runs.length > 0 && (
        <div>
          <div style={{ fontSize: S.subhead, fontFamily: T.heading, fontWeight: 600, color: T.text, marginBottom: S.md }}>Ingest history</div>
          <div style={{
            background: T.surfaceRaised, border: `1px solid ${T.border}`,
            borderRadius: S.r6, overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 80px 90px 100px 100px',
              gap: 12, padding: '8px 14px',
              fontSize: S.label, color: T.textFaint, fontFamily: T.sans,
              textTransform: 'uppercase', letterSpacing: '0.05em',
              borderBottom: `1px solid ${T.border}`,
            }}>
              <span>Date</span><span>System</span><span>Rows</span><span>Source</span><span>Status</span>
            </div>
            {runs.map((run) => <RunRow key={run.id} run={run} />)}
          </div>
        </div>
      )}

      {storeId && runs && runs.length === 0 && step !== 'upload' && (
        <div style={{ fontSize: S.small, color: T.textFaint, fontFamily: T.sans }}>No imports yet for this location.</div>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px',
  fontFamily: "'Inter', sans-serif", fontSize: 12,
  color: 'rgba(238, 244, 246, 0.60)',
  fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em',
}

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  color: 'rgba(238, 244, 246, 0.87)',
}
