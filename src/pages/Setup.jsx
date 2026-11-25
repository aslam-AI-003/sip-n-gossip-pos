import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { AuthBrand } from './Login.jsx';
import { errorMessage } from '../lib/format.js';

/** Shown only while /meta/setup does not exist: creates the owner (admin) account. */
export default function Setup() {
  const { bootstrapAdmin } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', tableCount: '8' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (f.password.length < 8) { setErr('Use a password of at least 8 characters.'); return; }
    if (f.password !== f.confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try { await bootstrapAdmin(f); } catch (x) { setErr(errorMessage(x)); setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <AuthBrand />
        <form className="card" onSubmit={submit}>
          <h2 style={{ marginBottom: 6 }}>First-time setup</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Create the owner account. It gets full admin access. This screen disappears once setup is complete.</p>
          {err ? <div className="alert error">{err}</div> : null}
          <div className="field"><label>Owner name</label><input value={f.name} onChange={set('name')} required /></div>
          <div className="field"><label>Email</label><input type="email" value={f.email} onChange={set('email')} required autoComplete="username" /></div>
          <div className="grid-2">
            <div className="field"><label>Password</label><input type="password" value={f.password} onChange={set('password')} required autoComplete="new-password" /></div>
            <div className="field"><label>Confirm</label><input type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></div>
          </div>
          <div className="field"><label>Number of dine-in tables (editable later)</label><input type="number" min="0" max="100" value={f.tableCount} onChange={set('tableCount')} /></div>
          <button type="submit" className="btn gold block lg" disabled={busy}>{busy ? <span className="spinner sm" /> : null}Create admin account</button>
        </form>
      </div>
    </div>
  );
}
