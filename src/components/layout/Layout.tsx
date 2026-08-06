import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import type { Me } from '../../App.tsx'
import { api } from '../../api.ts'
import { NAV } from '../../nav.ts'

export default function Layout({ me }: { me: Me }) {
  const [signingOut, setSigningOut] = useState(false)

  const signOut = async () => {
    setSigningOut(true)
    try {
      await api.post('/auth/signout')
    } finally {
      // Full reload rather than clearing React state: it re-runs the auth check
      // from scratch, so there is no chance of a stale signed-in view lingering.
      window.location.assign('/ppd_converter/')
    }
  }

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">
          <strong>PPD Converter</strong>
          <span className="brand-sub">United Ceres College</span>
        </div>
        <ul>
          {NAV.map((item) => (
            <li key={item.path}>
              <NavLink to={item.path} end={item.path === '/'} title={item.hint}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="account">
          <span className="account-email" title={me.email ?? ''}>
            {me.email}
          </span>
          {/* Surfaced here because a migration fails confusingly late if OpenAI
              is misconfigured — better to see it before starting one. */}
          {!me.capabilities.openai ? (
            <span className="account-warn">OpenAI is not configured</span>
          ) : null}
          <button type="button" onClick={signOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
