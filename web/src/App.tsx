import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserProvider } from './context/UserContext'
import { Layout } from './components/Layout'
import { CollectionPage } from './pages/CollectionPage'
import { BinderShelfPage } from './pages/BinderShelfPage'
import { BinderViewPage } from './pages/BinderViewPage'
import { AnalyzerPage } from './pages/AnalyzerPage'
import { SearchPage } from './pages/SearchPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // cache for 5 minutes
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/"                   element={<CollectionPage />} />
              <Route path="/binders"            element={<BinderShelfPage />} />
              <Route path="/binders/:binderId"  element={<BinderViewPage />} />
              <Route path="/analyzer"           element={<AnalyzerPage />} />
              <Route path="/search"             element={<SearchPage />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </UserProvider>
    </QueryClientProvider>
  )
}
