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

import { BrowserRouter, Navigate, Routes, Route, useLocation, useSearchParams } from 'react-router-dom'
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
import { RoomPage } from './pages/RoomPage'
import { ShopPage } from './pages/ShopPage'
import { ShopRequestsPage } from './pages/ShopRequestsPage'
import { LegalPage } from './pages/LegalPage'
import { ShareLinkRedirect } from './pages/ShareLinkRedirect'
import { NotFoundPage } from './pages/NotFoundPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // sets/cards change rarely; avoids refetching on every nav
      retry: 1,
    },
  },
})

/** The old Trade page now lives in My Shop: offer links (/trade?offer=<id>)
 *  open that offer there, anything else opens My Shop's Offers tab. */
function TradeRedirect() {
  const [params] = useSearchParams()
  const offer = params.get('offer')
  return <Navigate to={offer ? `/shop/requests?offer=${encodeURIComponent(offer)}` : '/shop/requests?tab=offers'} replace />
}

/** "/" is the 3D room. Spaces (the list view) used to be "/", and its views
 *  live in the query string (?area=&box=&unit=&case=&space=) — those links,
 *  bookmarks and the back-stack still open Spaces, now at /spaces. */
const SPACES_PARAMS = ['area', 'box', 'unit', 'case', 'space']
function Home() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  if (SPACES_PARAMS.some(p => params.has(p))) return <Navigate to={`/spaces${search}`} replace />
  return <RoomPage />
}

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
              <Route path="/"                  element={<Home />} />
              <Route path="/spaces"            element={<SpacesLivePage />} />
              <Route path="/explore"           element={<CollectionPage />} />
              <Route path="/spaces/default/storage" element={<Navigate to="/spaces?area=storage" replace />} />
              <Route path="/add"               element={<BulkAddPage />} />
              <Route path="/binder/:binderId"  element={<BinderViewPage />} />
              <Route path="/spaces/default/binders/:binderId" element={<BinderViewPage />} />
              <Route path="/spaces/:spaceId/binders/:binderId" element={<BinderViewPage />} />
              <Route path="/analyzer"          element={<AnalyzerPage />} />
              <Route path="/convention"        element={<ConventionModePage />} />
              <Route path="/trade"             element={<TradeRedirect />} />
              <Route path="/s/:slug"           element={<ShareLinkRedirect />} />
              <Route path="/shop/requests"     element={<ShopRequestsPage />} />
              <Route path="/shop/:slug"        element={<ShopPage />} />
              <Route path="/privacy"           element={<LegalPage page="privacy" />} />
              <Route path="/terms"             element={<LegalPage page="terms" />} />
              <Route path="/shelf"             element={<Navigate to="/spaces" replace />} />
              <Route path="/bulk"              element={<Navigate to="/add" replace />} />
              <Route path="/spaces/default/add" element={<Navigate to="/add" replace />} />
              <Route path="/owned"             element={<Navigate to="/spaces" replace />} />
              <Route path="*"                  element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </UserProvider>
    </QueryClientProvider>
  )
}
