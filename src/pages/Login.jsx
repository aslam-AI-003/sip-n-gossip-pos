import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useConnection } from '../context/ConnectionContext.jsx';
import { ConnBadge } from '../components/Layout.jsx';
import { errorMessage } from '../lib/format.js';

export function AuthBrand() {
  return (
    <div className="auth-brand">
      <img src="/icon.svg" alt="" />
      <div className="n">SIP N&apos; GOSSIP CAFE</div>
      <div className="t">Fresh Sips, Happy Vibes!</div>
    </div>
  );
}

export default function Login() {
  const { login, resetPassword } = useAuth();
  const { online } = useConnection();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setInfo(''); setBusy(true);
    try { await login(email, password); } catch (x) { setErr(errorMessage(x)); setBusy(false); }
  };
  const forgot = async () => {
    setErr(''); setInfo('');
    if (!email.trim()) { setErr('Enter your email first.'); return; }
    try { await resetPassword(email); setInfo('If that email has an account, a reset link has been sent.'); } catch (x) { setErr(errorMessage(x)); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <AuthBrand />
        <form className="card" onSubmit={submit}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}><h2>Staff sign in</h2><ConnBadge /></div>
          {err ? <div className="alert error">{err}</div> : null}
          {info ? <div className="alert ok">{info}</div> : null}
          <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <button type="submit" className="btn gold block lg" disabled={busy || !online}>{busy ? <span className="spinner sm" /> : null}Sign in</button>
          {!online ? <p className="muted" style={{ fontSize: 13 }}>An internet connection is required.</p> : null}
          <button type="button" className="btn ghost block" style={{ marginTop: 8 }} onClick={forgot}>Forgot password?</button>
        </form>
      </div>
    </div>
  );
}
