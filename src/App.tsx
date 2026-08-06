import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router'
import { api } from './api.ts'
import Layout from './components/layout/Layout.tsx'
import Dashboard from './pages/Dashboard.tsx'
import Migration from './pages/Migration.tsx'
import Reports from './pages/Reports.tsx'
import SignIn from './pages/SignIn.tsx'
import SourceDocuments from './pages/SourceDocuments.tsx'
import TemplateAndRules from './pages/TemplateAndRules.tsx'

export type Me = {
  email: string | null
  authorised: boolean
  capabilities: { google: boolean; openai: boolean; session: boolean }
  allowedAccount: string
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)

  // One check at the top, rather than letting every page discover its own 401.
  // /api/auth/me is deliberately outside the protected router so it can answer
  // before there is a session.
  useEffect(() => {
    api
      .get<Me>('/auth/me')
      .then(setMe)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) return <SignIn me={null} error={error} />
  if (!me) return <p className="empty checking">Checking your sign-in…</p>
  if (!me.authorised) return <SignIn me={me} />

  return (
    <Routes>
      <Route element={<Layout me={me} />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/source-documents" element={<SourceDocuments />} />
        <Route path="/template-and-rules" element={<TemplateAndRules />} />
        <Route path="/migration" element={<Migration />} />
        <Route path="/reports" element={<Reports />} />
      </Route>
    </Routes>
  )
}
