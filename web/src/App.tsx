/**
 * App — application shell.
 *
 * HOW IT WORKS
 *   Wires up React Query (server-state cache), the user session provider,
 *   the global toast, and react-router's routes — one per top-level page.
 *   Provider nesting order is deliberate: QueryClient outermost since any
 *   provider below it may read from the cache, then UserProvider, then
 *   ToastProvider, then routing last since it only needs to know which
 *   page to render.
 *
 * DEPENDS ON: pages/*, context/UserContext, components/Toast
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserProvider } from './context/UserContext'
import { ToastProvider } from './components/Toast'
import { CollectionPage } from './pages/CollectionPage'
import { ShelfPage } from './pages/ShelfPage'
import { BinderViewPage } from './pages/BinderViewPage'
import { AnalyzerPage } from './pages/AnalyzerPage'
import { ConventionModePage } from './pages/ConventionModePage'
import { BulkAddPage } from './pages/BulkAddPage'
import { OwnedPage } from './pages/OwnedPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // sets/cards change rarely; avoids refetching on every nav
      retry: 1,
    },
  },
})

/** Pages handle their own login gating — CollectionPage shows the login
 *  screen itself; the rest redirect to "/" when nobody's signed in. */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/"                  element={<CollectionPage />} />
              <Route path="/shelf"             element={<ShelfPage />} />
              <Route path="/binder/:binderId"  element={<BinderViewPage />} />
              <Route path="/analyzer"          element={<AnalyzerPage />} />
              <Route path="/convention"        element={<ConventionModePage />} />
              <Route path="/bulk"              element={<BulkAddPage />} />
              <Route path="/owned"             element={<OwnedPage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </UserProvider>
    </QueryClientProvider>
  )
}
