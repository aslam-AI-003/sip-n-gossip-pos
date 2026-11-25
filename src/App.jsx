import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isConfigured } from './firebase.js';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ConnectionProvider } from './context/ConnectionContext.jsx';
import { DataProvider, useData } from './context/DataContext.jsx';
import Layout from './components/Layout.jsx';
import Login, { AuthBrand } from './pages/Login.jsx';
import Setup from './pages/Setup.jsx';
import POS from './pages/POS.jsx';
import Orders from './pages/Orders.jsx';
import Tables from './pages/Tables.jsx';
import { errorMessage } from './lib/format.js';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Expenses = lazy(() => import('./pages/Expenses.jsx'));
const MenuAdmin = lazy(() => import('./pages/MenuAdmin.jsx'));
const Staff = lazy(() => import('./pages/Staff.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

const Spin = () => <div className="center-screen"><span className="spinner" /></div>;

function AdminOnly({ children }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/pos" replace />;
}

function Gate() {
  const { loading, fbUser, user, setupDone, setupError, checkSetup, logout } = useAuth();
  const { ready, error } = useData();

  if (setupError && setupDone === null) {
    return (
      <div className="center-screen">
        <div className="card" style={{ maxWidth: 420 }}>
          <AuthBrand />
          <div className="alert error">Cannot reach the database. {errorMessage(setupError)}</div>
          <button type="button" className="btn gold" onClick={checkSetup}>Retry</button>
        </div>
      </div>
    );
  }
  if (setupDone === null || loading) return <Spin />;
  if (!setupDone) return <Setup />;
  if (!fbUser) return <Login />;
  if (!user || !user.active) {
    return (
      <div className="center-screen">
        <div className="card" style={{ maxWidth: 420 }}>
          <AuthBrand />
          <p>{!user ? 'This login has no staff profile.' : 'This staff account is disabled.'} Ask the admin to give you access.</p>
          <button type="button" className="btn" onClick={logout}>Sign out</button>
        </div>
      </div>
    );
  }
  if (error && !ready) return <div className="center-screen"><div className="alert error">{errorMessage(error)}</div></div>;
  if (!ready) return <Spin />;

  return (
    <Suspense fallback={<Spin />}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/pos" element={<POS />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/tables" element={<Tables />} />
          <Route path="/dashboard" element={<AdminOnly><Dashboard /></AdminOnly>} />
          <Route path="/reports" element={<AdminOnly><Reports /></AdminOnly>} />
          <Route path="/expenses" element={<AdminOnly><Expenses /></AdminOnly>} />
          <Route path="/menu" element={<AdminOnly><MenuAdmin /></AdminOnly>} />
          <Route path="/staff" element={<AdminOnly><Staff /></AdminOnly>} />
          <Route path="/settings" element={<AdminOnly><Settings /></AdminOnly>} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  if (!isConfigured) {
    return (
      <div className="center-screen">
        <div className="card" style={{ maxWidth: 520, textAlign: 'left' }}>
          <AuthBrand />
          <h2>Firebase is not configured</h2>
          <p className="muted">Copy <code>.env.example</code> to <code>.env</code> and fill in the web app config of the SIP N&apos; GOSSIP Firebase project, then rebuild. On Vercel, add the same variables under Project → Settings → Environment Variables.</p>
        </div>
      </div>
    );
  }
  return (
    <BrowserRouter>
      <ConnectionProvider>
        <AuthProvider>
          <DataProvider>
            <Gate />
          </DataProvider>
        </AuthProvider>
      </ConnectionProvider>
    </BrowserRouter>
  );
}
