import { useEffect, useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, connectAuthEmulator, sendPasswordResetEmail,
} from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { FiPlus, FiMail } from 'react-icons/fi';
import { db, auth, app as primaryApp, useEmulator } from '../firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useConnection } from '../context/ConnectionContext.jsx';
import Modal from '../components/Modal.jsx';
import { errorMessage } from '../lib/format.js';

// A secondary Firebase app instance creates staff logins without signing the
// admin out. No Admin SDK credentials are needed in the browser.
function secondaryAuth() {
  const existing = getApps().find((a) => a.name === 'staff-admin');
  const a = existing || initializeApp(primaryApp.options, 'staff-admin');
  const au = getAuth(a);
  if (!existing && useEmulator) connectAuthEmulator(au, 'http://127.0.0.1:9099', { disableWarnings: true });
  return au;
}

export default function Staff() {
  const { user } = useAuth();
  const { online } = useConnection();
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => onSnapshot(collection(db, 'users'), (qs) => setRows(qs.docs.map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => (a.role === b.role ? (a.name || '').localeCompare(b.name || '') : a.role === 'admin' ? -1 : 1))),
  (e) => setMsg({ err: true, text: errorMessage(e) })), []);

  const update = async (r, patch) => {
    setMsg(null);
    try { await updateDoc(doc(db, 'users', r.uid), { ...patch, updatedAt: serverTimestamp() }); } catch (e) { setMsg({ err: true, text: errorMessage(e) }); }
  };
  const reset = async (r) => {
    try { await sendPasswordResetEmail(auth, r.email); setMsg({ text: `Password reset email sent to ${r.email}.` }); } catch (e) { setMsg({ err: true, text: errorMessage(e) }); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Staff</h1>
        <button type="button" className="btn gold" onClick={() => setAdding(true)} disabled={!online}><FiPlus />Add staff</button>
      </div>
      {msg ? <div className={`alert ${msg.err ? 'error' : 'ok'}`}>{msg.text}</div> : null}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th className="hide-sm">Email</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const self = r.uid === user.uid;
                return (
                  <tr key={r.uid}>
                    <td><strong>{r.name}</strong>{self ? <small> (you)</small> : null}<div className="hide-lg"><small>{r.email}</small></div></td>
                    <td className="hide-sm">{r.email}</td>
                    <td>
                      <select value={r.role} disabled={self || !online} onChange={(e) => update(r, { role: e.target.value })} style={{ maxWidth: 130 }}>
                        <option value="cashier">Cashier</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>
                      <button type="button" className={`btn sm ${r.active ? 'emerald' : 'danger'}`} disabled={self || !online} onClick={() => update(r, { active: !r.active })}>
                        {r.active ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                    <td className="num"><button type="button" className="btn sm" onClick={() => reset(r)} disabled={!online} title="Send password reset email"><FiMail /><span className="hide-sm">Reset password</span></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Disabling a staff member blocks all database access immediately (enforced by Firestore rules), even if they are still signed in.
        Cashiers can create bills, manage orders, take payments and print receipts. Admins also manage menu, reports, expenses, staff and settings.
      </p>
      {adding ? <AddStaff onClose={() => setAdding(false)} onDone={(t) => setMsg({ text: t })} /> : null}
    </div>
  );
}

function AddStaff({ onClose, onDone }) {
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'cashier' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setErr('');
    if (!f.name.trim() || !f.email.trim()) { setErr('Name and email are required.'); return; }
    if (f.password.length < 8) { setErr('Use a password of at least 8 characters.'); return; }
    setBusy(true);
    const sa = secondaryAuth();
    try {
      let cred;
      try {
        cred = await createUserWithEmailAndPassword(sa, f.email.trim(), f.password);
      } catch (e) {
        if (e.code !== 'auth/email-already-in-use') throw e;
        // Login exists (e.g. an earlier attempt failed half way): link it if the password matches.
        cred = await signInWithEmailAndPassword(sa, f.email.trim(), f.password);
      }
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: f.name.trim(), email: f.email.trim().toLowerCase(), role: f.role, active: true, createdAt: serverTimestamp(),
      });
      await signOut(sa);
      onDone(`${f.name} added as ${f.role}.`);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Add staff" onClose={onClose} busy={busy} footer={<button type="button" className="btn gold" onClick={save} disabled={busy}>{busy ? <span className="spinner sm" /> : null}Create login</button>}>
      {err ? <div className="alert error">{err}</div> : null}
      <div className="field"><label>Name</label><input value={f.name} onChange={set('name')} autoFocus /></div>
      <div className="field"><label>Email (used to sign in)</label><input type="email" value={f.email} onChange={set('email')} autoComplete="off" /></div>
      <div className="field"><label>Temporary password (min 8 characters)</label><input type="text" value={f.password} onChange={set('password')} autoComplete="new-password" /></div>
      <div className="field"><label>Role</label><select value={f.role} onChange={set('role')}><option value="cashier">Cashier</option><option value="admin">Admin</option></select></div>
    </Modal>
  );
}
