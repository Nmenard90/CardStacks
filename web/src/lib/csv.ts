/**
 * CSV export/import for the collection, ported from the old tracker.
 *
 * HOW IT WORKS
 *   Export builds CSV text by hand (quoting/escaping per RFC 4180) and
 *   triggers a browser download via a Blob object URL. Import hand-parses
 *   pasted/uploaded text character-by-character rather than splitting on
 *   commas, so a comma inside a quoted cell doesn't split the cell.
 *
 * USED BY: CollectionPage
 */

/** RFC 4180 quoting: double any embedded quote, wrap the cell in quotes. */
const q = (v: string | number) => '"' + String(v).replace(/"/g, '""') + '"'

/**
 * Downloads `rows` as a CSV file. Uses a Blob + object URL rather than a
 * `data:` URI — data URIs silently truncate past a length cap, which was
 * the old "export did nothing" bug on large collections. The leading BOM
 * makes Excel detect UTF-8 instead of misreading non-ASCII characters.
 */
export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  // Some browsers only fire the download from a link that's actually in the DOM.
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface ImportRow { cardId: string; quantity: number; condition: string }

/**
 * Parses pasted/uploaded CSV. Header row is optional — detected by a
 * "card id" column; absent, columns default to card ID, quantity,
 * condition in that order. Returns valid rows plus a count of lines
 * skipped for a malformed card ID or quantity.
 */
export function parseImport(text: string): { rows: ImportRow[]; skipped: number } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return { rows: [], skipped: 0 }

  // Hand-rolled instead of split(',') so a comma inside a quoted cell
  // (e.g. a card name) doesn't get treated as a column boundary.
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
