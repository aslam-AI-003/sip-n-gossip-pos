import { useState } from 'react';
import { FiPrinter, FiDownload, FiShare2 } from 'react-icons/fi';
import Modal from './Modal.jsx';
import Receipt from './Receipt.jsx';
import { printReceipt } from '../lib/print.js';
import { downloadReceiptPdf, shareReceiptPdf, canShareFiles } from '../lib/receiptPdf.js';
import { markPrinted } from '../lib/orders.js';
import { errorMessage } from '../lib/format.js';

export default function ReceiptModal({ order, settings, onClose, title, extraActions }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const reprint = (order.printCount || 0) > 0;

  const run = async (kind) => {
    setErr('');
    setBusy(kind);
    try {
      if (kind === 'print') {
        await printReceipt(order, settings, { reprint });
        markPrinted(order.id);
      } else if (kind === 'pdf') {
        await downloadReceiptPdf(order, settings);
      } else if (kind === 'share') {
        await shareReceiptPdf(order, settings);
      }
    } catch (e) {
      if (e?.name !== 'AbortError') setErr(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal
      title={title || (order.billNo ? `Bill ${order.billNo}` : `Order #${order.orderNo}`)}
      onClose={onClose}
      footer={(
        <>
          {extraActions}
          {canShareFiles() ? (
            <button type="button" className="btn" onClick={() => run('share')} disabled={!!busy}><FiShare2 />Share PDF</button>
          ) : null}
          <button type="button" className="btn" onClick={() => run('pdf')} disabled={!!busy}><FiDownload />PDF</button>
          <button type="button" className="btn gold" onClick={() => run('print')} disabled={!!busy}><FiPrinter />{reprint ? 'Reprint' : 'Print'}</button>
        </>
      )}
    >
      {err ? <div className="alert error">{err}</div> : null}
      <div style={{ overflowX: 'auto', background: '#2a2a2a', padding: 12, borderRadius: 8 }}>
        <div className="receipt-preview" style={{ width: 'fit-content', padding: 0 }}>
          <Receipt order={order} settings={settings} reprint={reprint} />
        </div>
      </div>
    </Modal>
  );
}
