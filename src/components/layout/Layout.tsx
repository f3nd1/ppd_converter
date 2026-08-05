import { NavLink, Outlet } from 'react-router'
import { NAV } from '../../nav.ts'

export default function Layout() {
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
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
