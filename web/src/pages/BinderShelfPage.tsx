import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getBinders, createBinder, deleteBinder } from '../api/binders'
import { useUser } from '../context/UserContext'
import { Modal } from '../components/Modal'
import type { PocketSize } from '../types'

const POCKET_SIZES: { label: string; value: PocketSize; slots: number }[] = [
  { label: '9-Pocket', value: 'Nine',   slots: 9  },
  { label: '4-Pocket', value: 'Four',   slots: 4  },
  { label: '12-Pocket', value: 'Twelve', slots: 12 },
]

export function BinderShelfPage() {
  const { user } = useUser()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSize, setNewSize] = useState<PocketSize>('Nine')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const { data: binders = [], isLoading } = useQuery({
    queryKey: ['binders', user?.id],
    queryFn: () => getBinders(user!.id),
    enabled: !!user,
  })

  const createMutation = useMutation({
    mutationFn: () => createBinder(user!.id, newName.trim(), newSize),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['binders', user?.id] })
      setCreateOpen(false)
      setNewName('')
      setNewSize('Nine')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBinder(user!.id, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['binders', user?.id] })
      setDeleteConfirm(null)
    },
  })

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-52px)] gap-4 text-slate-500">
        <span className="text-5xl">📚</span>
        <p className="text-lg">Sign in to manage your binders</p>
      </div>
    )
  }

  const pocketCount = (size: PocketSize) => POCKET_SIZES.find(p => p.value === size)?.slots ?? 9

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Binder Shelf</h1>
          <p className="text-sm text-slate-500 mt-0.5">{binders.length} binder{binders.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 bg-[#ffcb05] hover:bg-yellow-400 text-black font-semibold rounded-lg text-sm transition-colors"
        >
          + New Binder
        </button>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 gap-3 text-slate-500">
          <div className="w-6 h-6 border-2 border-slate-600 border-t-[#ffcb05] rounded-full animate-spin" />
          <span>Loading binders…</span>
        </div>
      ) : binders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500">
          <span className="text-6xl">📚</span>
          <p className="text-lg">No binders yet</p>
          <button
            onClick={() => setCreateOpen(true)}
            className="px-4 py-2 bg-[#ffcb05]/10 border border-[#ffcb05]/30 text-[#ffcb05] rounded-lg text-sm hover:bg-[#ffcb05]/20 transition-colors"
          >
            Create your first binder
          </button>
        </div>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {binders.map(binder => (
            <div key={binder.id} className="relative group cursor-pointer" onClick={() => navigate(`/binders/${binder.id}`)}>
              {/* Cover */}
              <div className="relative h-56 rounded-xl overflow-hidden bg-gradient-to-br from-indigo-900 to-purple-900 border border-white/10 group-hover:border-indigo-500/50 transition-all group-hover:shadow-lg group-hover:shadow-indigo-900/30">
                {/* Spine */}
                <div className="absolute left-0 top-0 bottom-0 w-3.5 bg-gradient-to-b from-indigo-700 via-indigo-800 to-indigo-700 flex flex-col justify-evenly items-center py-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="w-2.5 h-2.5 rounded-full bg-indigo-400/40 border border-indigo-300/20" />
                  ))}
                </div>

                {/* Cover image or placeholder */}
                {binder.coverImage ? (
                  <img src={binder.coverImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-5xl select-none">📖</div>
                )}

                {/* Bottom gradient overlay */}
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />

                {/* Delete button */}
                <button
                  onClick={e => { e.stopPropagation(); setDeleteConfirm(binder.id) }}
                  className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-red-600/80 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              {/* Info */}
              <div className="mt-2 px-1">
                <div className="text-sm font-semibold text-white truncate">{binder.name}</div>
                <div className="text-xs text-slate-500">{pocketCount(binder.pocketSize)}-pocket</div>
              </div>

              {/* Delete confirmation overlay */}
              {deleteConfirm === binder.id && (
                <div
                  className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center gap-3 p-4"
                  onClick={e => e.stopPropagation()}
                >
                  <p className="text-sm text-white text-center font-medium">Delete "{binder.name}"?</p>
                  <p className="text-xs text-slate-400 text-center">This cannot be undone.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="px-3 py-1.5 text-xs text-slate-300 border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(binder.id)}
                      className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Binder">
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Binder name</label>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && newName.trim() && createMutation.mutate()}
              maxLength={40}
              placeholder="My Charizards"
              className="w-full bg-[#13111e] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#ffcb05]/50"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Pocket size</label>
            <div className="flex gap-2">
              {POCKET_SIZES.map(p => (
                <button
                  key={p.value}
                  onClick={() => setNewSize(p.value)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    newSize === p.value
                      ? 'bg-[#ffcb05]/10 border-[#ffcb05]/50 text-[#ffcb05]'
                      : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => newName.trim() && createMutation.mutate()}
            disabled={!newName.trim() || createMutation.isPending}
            className="w-full bg-[#ffcb05] hover:bg-yellow-400 text-black font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating…' : 'Create Binder'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
