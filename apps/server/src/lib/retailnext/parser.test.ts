import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseRetailNextXls } from './parser.js'

// Build a minimal two-sheet RetailNext workbook buffer. Sheet1 row 0 is the
// title (where the report date is parsed from), row 3 is the "Today" data row.
// Sheet2 is the hourly breakdown (rows 0-2 are headers, data starts at row 3).
function makeWorkbook(title: string): Buffer {
  const sheet1 = XLSX.utils.aoa_to_sheet([
    [title],
    ['Metric', 'Traffic', 'Sales', 'SaleTrx', 'ReturnTrx', 'Conv', 'ATV', 'Yield', 'Capture', 'NewShopper', 'Duration', 'Weather'],
    ['Yesterday', 100, 1000, 10, 1, 0.1, 50, 0.2, 0.3, 0.4, '5m 0s', 'Sunny'],
    ['Today', 120, 2000, 20, 2, 0.15, 60, 0.25, 0.35, 0.45, '6m 1s', 'Cloudy'],
  ])
  const sheet2 = XLSX.utils.aoa_to_sheet([
    ['Hourly'],
    ['header'],
    ['header'],
    ['10:00-11:00 AM', 12, 200, 2, 0, 0.1, 50, 0.2, 0.3, '4m 0s'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet1, 'Daily')
  XLSX.utils.book_append_sheet(wb, sheet2, 'Hourly')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('parseRetailNextXls — report date validation', () => {
  it('parses the report date from a well-formed title', () => {
    const buf = makeWorkbook('015 UNTUCKit Park Meadows Daily Comprehensive Traffic Report for Apr 30, 2026')
    const { daily } = parseRetailNextXls(buf)
    expect(daily.retailNextStoreId).toBe('015')
    // Keyed to the real report date, not the ingest day.
    expect(daily.reportDate.getFullYear()).toBe(2026)
    expect(daily.reportDate.getMonth()).toBe(3) // April (0-indexed)
    expect(daily.reportDate.getDate()).toBe(30)
  })

  it('throws (does not default to today) when the title has a "for <date>" but the date is unparseable', () => {
    const buf = makeWorkbook('015 UNTUCKit Daily Report for NotARealDate')
    // Without the guard, new Date("NotARealDate") yields an Invalid Date object
    // and the snapshot would silently key to now. Must fail loudly instead.
    expect(() => parseRetailNextXls(buf)).toThrow(/report date could not be parsed/)
  })

  it('throws when the title lacks a "for <date>" segment entirely', () => {
    // Previously this silently keyed the snapshot to TODAY, overwriting a real
    // day's row on upsert.
    const buf = makeWorkbook('015 UNTUCKit Daily Comprehensive Traffic Report')
    expect(() => parseRetailNextXls(buf)).toThrow(/report date could not be parsed/)
  })
})
