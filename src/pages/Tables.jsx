import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { FiShoppingBag, FiPackage } from 'react-icons/fi';
import { db } from '../firebase.js';
import { useData } from '../context/DataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { inr, toDate } from '../lib/format.js';
import '../pages/POS.css';

function elapsed(ts) {
  const d = toDate(ts);
  if (!d) return '';
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function Tables() {
  const { tables } = useData();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState({});
  const [, tick] = useState(0);

  useEffect(() => onSnapshot(query(collection(db, 'orders'), where('status', '==', 'active')), (qs) => {
    setActive(Object.fromEntries(qs.docs.map((d) => [d.id, d.data()])));
  }, () => {}), []);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60000); return () => clearInterval(t); }, []);

  const busy = tables.filter((t) => t.activeOrderId).length;

  return (
    <div className="page">
      <div className="page-head">
        <div className="row wrap">
          <span className="badge green">{tables.length - busy} available</span>
          <span className="badge gold">{busy} occupied</span>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => navigate('/pos?type=takeaway')}><FiShoppingBag />Takeaway</button>
          <button type="button" className="btn" onClick={() => navigate('/pos?type=parcel')}><FiPackage />Parcel</button>
        </div>
      </div>
      {tables.length === 0 ? <div className="empty">No tables configured.{isAdmin ? ' Add tables in Settings → Tables.' : ''}</div> : null}
      <div className="table-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {tables.map((t) => {
          const o = t.activeOrderId ? active[t.activeOrderId] : null;
          return (
            <button key={t.id} type="button" className={`table-tile${t.activeOrderId ? ' busy' : ''}`} style={{ minHeight: 110 }} onClick={() => navigate(`/pos?table=${t.id}`)}>
              <span className="tt-name">{t.name}</span>
              {o ? (
                <>
                  <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{inr(o.grandTotal)}</span>
                  <span className="tt-state">#{o.orderNo} · {elapsed(o.createdAt)}</span>
                </>
              ) : <span className="tt-state">{t.activeOrderId ? 'Occupied' : 'Available'}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
