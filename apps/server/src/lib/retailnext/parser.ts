import * as XLSX from 'xlsx'

export interface RetailNextDaily {
  retailNextStoreId: string | null // e.g. "015"
  reportDate: Date                 // the "Today" date
  traffic: number | null
  salesCents: bigint | null
  saleTrxCount: number | null
  returnTrxCount: number | null
  convRate: number | null
  atv: number | null
  shopperYield: number | null
  captureRate: number | null
  newShopperPct: number | null
  visitDurationSecs: number | null
  weather: string | null
}

export interface RetailNextHourly {
  date: Date
  hourStart: number
  traffic: number | null
  salesCents: bigint | null
  saleTrxCount: number | null
  returnTrxCount: number | null
  convRate: number | null
  atv: number | null
  shopperYield: number | null
  captureRate: number | null
  visitDurationSecs: number | null
}

export interface RetailNextParseResult {
  daily: RetailNextDaily
  hourly: RetailNextHourly[]
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isNaN(n) ? null : n
}

function parseSalesCents(v: unknown): bigint | null {
  const n = parseNum(v)
  if (n === null) return null
  return BigInt(Math.round(n * 100))
}

// "6m 1s" → 361, "0s" → 0, "1h 2m 3s" → 3723
function parseDuration(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (s === '0s' || s === '0') return 0
  let total = 0
  const h = s.match(/(\d+)h/)
  const m = s.match(/(\d+)m/)
  const sec = s.match(/(\d+)s/)
  if (!h && !m && !sec) return null
  if (h) total += parseInt(h[1]) * 3600
  if (m) total += parseInt(m[1]) * 60
  if (sec) total += parseInt(sec[1])
  return total
}

// "10:00-11:00 AM" → 10, "1:00-2:00 PM" → 13
function parseHourStart(label: string): number | null {
  const m = label.match(/^(\d{1,2}):00[-–]/)
  if (!m) return null
  let h = parseInt(m[1])
  const isPm = /PM/i.test(label)
  const isAm = /AM/i.test(label)
  if (isPm && h !== 12) h += 12
  if (isAm && h === 12) h = 0
  return h
}

// "015 UNTUCKit Park Meadows Daily Comprehensive Traffic Report for Apr 30, 2026"
function parseTitleRow(title: string): { storeId: string | null; reportDate: Date | null } {
  const storeIdMatch = title.match(/^(\d+)\s/)
  const dateMatch = title.match(/for\s+(.+)$/)
  return {
    storeId: storeIdMatch ? storeIdMatch[1] : null,
    reportDate: dateMatch ? new Date(dateMatch[1]) : null,
  }
}

export function parseRetailNextXls(buf: Buffer): RetailNextParseResult {
  const wb = XLSX.read(buf, { type: 'buffer' })

  // ---- Sheet1: daily summary ----
  const sheet1 = wb.Sheets[wb.SheetNames[0]]
  const rows1: unknown[][] = XLSX.utils.sheet_to_json(sheet1, { header: 1, defval: null })

  const titleCell = rows1[0]?.[0]
  const { storeId: retailNextStoreId, reportDate: parsedDate } = parseTitleRow(String(titleCell ?? ''))

  // Row index 3 = "Today"
  const todayRow = rows1[3] as unknown[]

  const daily: RetailNextDaily = {
    retailNextStoreId,
    reportDate: parsedDate ?? new Date(),
    traffic: parseNum(todayRow[1]),
    salesCents: parseSalesCents(todayRow[2]),
    saleTrxCount: parseNum(todayRow[3]) !== null ? Math.round(parseNum(todayRow[3])!) : null,
    returnTrxCount: parseNum(todayRow[4]) !== null ? Math.round(parseNum(todayRow[4])!) : null,
    convRate: parseNum(todayRow[5]),
    atv: parseNum(todayRow[6]),
    shopperYield: parseNum(todayRow[7]),
    captureRate: parseNum(todayRow[8]),
    newShopperPct: parseNum(todayRow[9]),
    visitDurationSecs: parseDuration(todayRow[10]),
    weather: todayRow[11] != null ? String(todayRow[11]) : null,
  }

  // ---- Sheet2: hourly breakdown ----
  const sheet2 = wb.Sheets[wb.SheetNames[1]]
  const rows2: unknown[][] = XLSX.utils.sheet_to_json(sheet2, { header: 1, defval: null })

  const hourly: RetailNextHourly[] = []
  for (let i = 3; i < rows2.length; i++) {
    const row = rows2[i] as unknown[]
    const label = row[0]
    if (!label || typeof label !== 'string' || label.startsWith('Weather')) continue
    const hourStart = parseHourStart(label)
    if (hourStart === null) continue
    hourly.push({
      date: daily.reportDate,
      hourStart,
      traffic: parseNum(row[1]) !== null ? Math.round(parseNum(row[1])!) : null,
      salesCents: parseSalesCents(row[2]),
      saleTrxCount: parseNum(row[3]) !== null ? Math.round(parseNum(row[3])!) : null,
      returnTrxCount: parseNum(row[4]) !== null ? Math.round(parseNum(row[4])!) : null,
      convRate: parseNum(row[5]),
      atv: parseNum(row[6]),
      shopperYield: parseNum(row[7]),
      captureRate: parseNum(row[8]),
      visitDurationSecs: parseDuration(row[9]),
    })
  }

  return { daily, hourly }
}
