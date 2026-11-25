import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  FiShoppingCart, FiList, FiGrid, FiBarChart2, FiFileText, FiDollarSign, FiBookOpen, FiUsers, FiSettings, FiLogOut, FiMoreHorizontal,
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext.jsx';
import { useConnection } from '../context/ConnectionContext.jsx';
import { useData } from '../context/DataContext.jsx';
import Modal from './Modal.jsx';

const NAV = [
  { to: '/pos', label: 'Billing', icon: FiShoppingCart },
  { to: '/orders', label: 'Orders', icon: FiList },
  { to: '/tables', label: 'Tables', icon: FiGrid },
  { to: '/dashboard', label: 'Dashboard', icon: FiBarChart2, admin: true },
  { to: '/reports', label: 'Reports', icon: FiFileText, admin: true },
  { to: '/expenses', label: 'Expenses', icon: FiDollarSign, admin: true },
  { to: '/menu', label: 'Menu', icon: FiBookOpen, admin: true },
  { to: '/staff', label: 'Staff', icon: FiUsers, admin: true },
  { to: '/settings', label: 'Settings', icon: FiSettings, admin: true },
];

export function ConnBadge() {
  const { status, verify } = useConnection();
  const label = status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Checking…';
  return (
    <button type="button" className={`conn ${status}`} onClick={() => verify()} title="Tap to re-check connection" style={{ background: 'none', cursor: 'pointer' }}>
      <span className="dot" />{label}
    </button>
  );
}

export default function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const { status } = useConnection();
  const { settings } = useData();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const items = NAV.filter((n) => !n.admin || isAdmin);
  const current = items.find((n) => loc.pathname.startsWith(n.to));
  const primary = items.slice(0, isAdmin ? 4 : 3);
  const secondary = items.slice(primary.length);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">{settings.restaurantName}</div>
          <div className="brand-tag">{settings.tagline}</div>
        </div>
        <nav className="nav">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}><Icon />{label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>{user?.name}</div>
            <small style={{ textTransform: 'capitalize' }}>{user?.role}</small>
          </div>
          <button type="button" className="btn block sm" onClick={logout}><FiLogOut />Sign out</button>
        </div>
      </aside>

      <div className="main">
        {status === 'offline' ? (
          <div className="offline-banner" role="alert">
            No internet connection. Billing and payments are disabled until the connection is restored.
          </div>
        ) : null}
        <header className="topbar">
          <span className="brand-mini">SIP N' GOSSIP</span>
          <span className="title">{current?.label || ''}</span>
          <ConnBadge />
        </header>
        <Outlet />
      </div>

      <nav className="bottom-nav">
        {primary.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}><Icon />{label}</NavLink>
        ))}
        <button type="button" onClick={() => setMore(true)}><FiMoreHorizontal />More</button>
      </nav>

      {more ? (
        <Modal title="Menu" onClose={() => setMore(false)}>
          <div className="nav" style={{ padding: 0 }}>
            {secondary.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={() => setMore(false)}><Icon />{label}</NavLink>
            ))}
          </div>
          <hr />
          <div className="row">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{user?.name}</div>
              <small style={{ textTransform: 'capitalize' }}>{user?.role}</small>
            </div>
            <button type="button" className="btn" onClick={logout}><FiLogOut />Sign out</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
