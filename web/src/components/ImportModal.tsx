/**
 * "⬆ IMPORT CSV" popup: paste or upload CSV, validate it, hand the parsed
 * rows back to the page to actually save.
 *
 * USED BY: CollectionPage
 */

import { useRef, useState } from 'react'
import { parseImport, type ImportRow } from '../lib/csv'

interface Props {
  open: boolean
  onClose: () => void
  /** Receives the validated rows; resolves to a result message for the modal. */
  onImport: (rows: ImportRow[]) => Promise<string>
}

export function ImportModal({ open, onClose, onImport }: Props) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(f)
  }

  const run = async () => {
    const { rows, skipped } = parseImport(text)
    if (rows.length === 0) {
      setResult({ ok: false, msg: 'No valid rows found. Need "Card ID" and "Quantity" columns.' })
      return
    }

    setBusy(true)
    try {
      const msg = await onImport(rows)
      setResult({ ok: true, msg: msg + (skipped > 0 ? ` (${skipped} line${skipped === 1 ? '' : 's'} skipped)` : '') })
      setText('')
    } catch {
      setResult({ ok: false, msg: 'Import failed — check the backend is reachable and try again.' })
    } finally {
      setBusy(false)
    }
  }

  const downloadTemplate = () => {
    const csv = 'Card ID,Quantity,Condition\nsv1-1,2,NM\nbase1-4,1,LP\n'
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: 'poketracker-template.csv',
    })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>⬆ IMPORT CSV</h3>
        <p>
          Required columns: <b>Card ID</b>, <b>Quantity</b>.
          Optional: <b>Condition</b> (NM / LP / MP / HP / DMG — defaults to NM if omitted).
          <br />
          Card IDs look like <code>sv1-1</code>, <code>base1-4</code> — same format as the Export CSV.
          Rows missing a valid Card ID or with Quantity&nbsp;≤&nbsp;0 are skipped.
        </p>

        <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} />
        <textarea
          placeholder={'Card ID,Quantity,Condition\nsv1-1,2,NM\nbase1-4,1,LP'}
          value={text} onChange={e => setText(e.target.value)}
        />

        {result && <div className={'import-result ' + (result.ok ? 'ok' : 'err')}>{result.msg}</div>}
        <div className="modal-btns">
          <button className="tb-btn" onClick={downloadTemplate}>⬇ Template</button>
          <button className="tb-btn" onClick={() => fileRef.current?.click()}>📁 Upload file</button>
          <button className="tb-btn" onClick={onClose}>Cancel</button>
          <button className="tb-btn primary" onClick={run} disabled={busy}>Import</button>
        </div>
      </div>
    </div>
  )
}
