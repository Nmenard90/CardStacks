/**
 * FILE: App.tsx
 * LOCATION: src/App.tsx
 *
 * PURPOSE:
 *   Application shell. Wires up React Query (server cache), the user
 *   session provider, the global toast, and the four routes — mirroring
 *   the old app's URLs: / (tracker), /shelf (binders), /binder/:binderId
 *   (one binder), /analyzer (trade analyzer).
 *
 * IMPORTS EXPLAINED:
 *   BrowserRouter/Routes/Route — client-side routing (react-router-dom)
 *   QueryClient/Provider       — request caching for sets/cards/binders
 *   UserProvider               — who is logged in, persisted to localStorage
 *   ToastProvider              — the bottom-right toast from the old app
 *
 * USED BY: main.tsx
 * DEPENDS ON: pages/*, context/UserContext, components/Toast
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserProvider } from './context/UserContext'
import { ToastProvider } from './components/Toast'
import { CollectionPage } from './pages/CollectionPage'
import { BinderShelfPage } from './pages/BinderShelfPage'
import { BinderViewPage } from './pages/BinderViewPage'
import { AnalyzerPage } from './pages/AnalyzerPage'
import { ConventionModePage } from './pages/ConventionModePage'
import { BulkAddPage } from './pages/BulkAddPage'

/**
 * VALUE: queryClient
 * PURPOSE: One shared React Query cache. Sets and cards change rarely,
 *          so a 5-minute staleTime avoids refetching on every navigation.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // cache for 5 minutes
      retry: 1,                 // one retry, then surface the error
    },
  },
})

/**
 * COMPONENT: App
 * PURPOSE: Mounts providers and routes. Pages handle their own login
 *          gating — the tracker shows the login screen, the others
 *          bounce back to "/" when nobody is signed in.
 * @returns The root React element
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/"                  element={<CollectionPage />} />
              <Route path="/shelf"             element={<BinderShelfPage />} />
              <Route path="/binder/:binderId"  element={<BinderViewPage />} />
              <Route path="/analyzer"          element={<AnalyzerPage />} />
              <Route path="/convention"        element={<ConventionModePage />} />
              <Route path="/bulk"              element={<BulkAddPage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </UserProvider>
    </QueryClientProvider>
  )
}
