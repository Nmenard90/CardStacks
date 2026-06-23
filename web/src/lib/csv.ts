/**
 * FILE: csv.ts — CSV export/import helpers, ported from the old tracker.
 * Export: one row per owned card, quoted cells, same columns as before.
 * Import: needs "Card ID" and "Quantity" columns; "Condition" optional (NM).
 * USED BY: CollectionPage
 */

/** Quote a cell the way the old app did: wrap and double inner quotes. */
const q = (v: string | number) => '"' + String(v).replace(/"/g, '""') + '"'

/**
 * Build the CSV text and trigger a browser download.
 * Uses a Blob + object URL rather than a `data:` URI: data URIs have a length
 * cap that large collections silently exceed (the old cause of "export did
 * nothing"), and the link must be in the document for some browsers to click it.
 * A leading BOM makes Excel open the UTF-8 file with correct characters.
 */
export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = '\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** One parsed import line. */
export interface ImportRow { cardId: string; quantity: number; condition: string }

/**
 * Parse pasted/uploaded CSV. Header row optional — detected by the
 * literal "card id". Returns rows plus a count of lines skipped.
 */
export function parseImport(text: string): { rows: ImportRow[]; skipped: number } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return { rows: [], skipped: 0 }

  // Split a CSV line respecting quoted cells.
  const split = (line: string): string[] => {
    const out: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') inQ = false
        else cur += ch
      } else if (ch === '"') inQ = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return out.map(c => c.trim())
  }

  let idCol = 0, qtyCol = 1, condCol = -1, start = 0
  const head = split(lines[0]).map(c => c.toLowerCase())
  if (head.some(c => c.includes('card id'))) {
    idCol = head.findIndex(c => c.includes('card id'))
    qtyCol = head.findIndex(c => c.includes('quantity'))
    condCol = head.findIndex(c => c.includes('condition'))
    start = 1
  }

  const rows: ImportRow[] = []
  let skipped = 0
  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i])
    const cardId = cells[idCol] ?? ''
    const quantity = parseInt(cells[qtyCol] ?? '', 10)
    if (!/^[\w.]+-[\w.]+$/.test(cardId) || !Number.isFinite(quantity) || quantity < 0) {
      skipped++
      continue
    }
    rows.push({ cardId, quantity, condition: (condCol >= 0 && cells[condCol]) || 'NM' })
  }
  return { rows, skipped }
}
