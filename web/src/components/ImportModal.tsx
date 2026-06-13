/**
 * FILE: ImportModal.tsx
 * LOCATION: src/components/ImportModal.tsx
 *
 * PURPOSE:
 *   The old "⬆ IMPORT CSV" modal: paste CSV or upload a file, validate,
 *   and hand parsed rows back to the page to bulk-save.
 *
 * USED BY: CollectionPage
 */
import { useRef, useState } from 'react'
import { parseImport, type ImportRow } from '../lib/csv'

interface Props {
  open: boolean
  onClose: () => void
  /** Receives validated rows; resolves to a result message for the modal. */
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

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>⬆ IMPORT CSV</h3>
        <p>
          Paste a CSV or upload a file. Expected columns: <b>Card ID</b> and <b>Quantity</b> (minimum).
          A <b>Condition</b> column is used when present (defaults to NM).
          <br /><br />
          Card IDs look like <b>sv1-1</b>, <b>base1-4</b> etc. — same format as the Export CSV.
        </p>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} />
        <textarea
          placeholder={'Card ID,Quantity\nsv1-1,2\nbase1-4,1'}
          value={text} onChange={e => setText(e.target.value)}
        />
        {result && <div className={'import-result ' + (result.ok ? 'ok' : 'err')}>{result.msg}</div>}
        <div className="modal-btns">
          <button className="tb-btn" onClick={() => fileRef.current?.click()}>📁 Upload file</button>
          <button className="tb-btn" onClick={onClose}>Cancel</button>
          <button className="tb-btn primary" onClick={run} disabled={busy}>Import</button>
        </div>
      </div>
    </div>
  )
}
