import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import type { Me } from '../../App.tsx'
import { api } from '../../api.ts'
import { navGroups, titleForPath } from '../../nav.ts'

export default function Layout({ me }: { me: Me }) {
  const [signingOut, setSigningOut] = useState(false)
  const location = useLocation()

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
      <aside className="sidebar">
        <div className="brand">PPD Converter</div>
        <div className="brand-sub">Policy &amp; Procedure Migration</div>

        <nav className="nav" aria-label="Primary">
          {navGroups().map((group) => (
            <div key={group.group}>
              <div className="nav-section">{group.group}</div>
              {group.items.map((item) => (
                <NavLink key={item.path} to={item.path} end={item.path === '/'} title={item.hint}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Surfaced here because a migration otherwise fails confusingly late
            if OpenAI is misconfigured. */}
        {!me.capabilities.openai ? (
          <div className="side-warn">OpenAI is not configured</div>
        ) : null}
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{titleForPath(location.pathname)}</h1>
          <div className="user">
            <span className="account-email" title={me.email ?? ''}>
              {me.email}
            </span>
            <button type="button" onClick={signOut} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>
        <div className="page">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
