import { Route, Routes } from 'react-router'
import Layout from './components/layout/Layout.tsx'
import Dashboard from './pages/Dashboard.tsx'
import SourceDocuments from './pages/SourceDocuments.tsx'
import TemplateAndRules from './pages/TemplateAndRules.tsx'
import Migration from './pages/Migration.tsx'
import Reports from './pages/Reports.tsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/source-documents" element={<SourceDocuments />} />
        <Route path="/template-and-rules" element={<TemplateAndRules />} />
        <Route path="/migration" element={<Migration />} />
        <Route path="/reports" element={<Reports />} />
      </Route>
    </Routes>
  )
}
