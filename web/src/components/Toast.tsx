import type { Toast } from '../hooks/useToast'

interface Props {
  toasts: Toast[]
}

export function ToastContainer({ toasts }: Props) {
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`px-4 py-3 rounded-lg text-sm font-medium shadow-lg animate-fade-in ${
            t.type === 'success' ? 'bg-green-600 text-white' :
            t.type === 'error'   ? 'bg-red-600 text-white' :
                                   'bg-slate-700 text-white'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
