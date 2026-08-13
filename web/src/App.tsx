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

import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserProvider } from './context/UserContext'
import { ToastProvider } from './components/Toast'
import { DemoBanner } from './components/DemoBanner'
import { CollectionPage } from './pages/CollectionPage'
import { BinderViewPage } from './pages/BinderViewPage'
import { AnalyzerPage } from './pages/AnalyzerPage'
import { ConventionModePage } from './pages/ConventionModePage'
import { BulkAddPage } from './pages/BulkAddPage'
import { SpacesLivePage } from './pages/SpacesLivePage'

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
        <DemoBanner />
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/"                  element={<SpacesLivePage />} />
              <Route path="/explore"           element={<CollectionPage />} />
              <Route path="/spaces/default/storage" element={<Navigate to="/" replace />} />
              <Route path="/add"               element={<BulkAddPage />} />
              <Route path="/binder/:binderId"  element={<BinderViewPage />} />
              <Route path="/spaces/default/binders/:binderId" element={<BinderViewPage />} />
              <Route path="/spaces/:spaceId/binders/:binderId" element={<BinderViewPage />} />
              <Route path="/analyzer"          element={<AnalyzerPage />} />
              <Route path="/convention"        element={<ConventionModePage />} />
              <Route path="/shelf"             element={<Navigate to="/" replace />} />
              <Route path="/bulk"              element={<Navigate to="/add" replace />} />
              <Route path="/spaces/default/add" element={<Navigate to="/add" replace />} />
              <Route path="/owned"             element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </UserProvider>
    </QueryClientProvider>
  )
}
