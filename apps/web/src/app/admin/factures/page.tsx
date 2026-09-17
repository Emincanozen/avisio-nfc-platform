'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL, api, getToken } from '@/lib/api';
import { Empty, formatDate } from '@/components/ui';

interface AdminInvoice {
  id: string;
  number: string;
  establishmentId: string;
  establishmentName: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueAt: string;
  paidAt?: string;
  totalCents: number;
  totalLabel: string;
  remindersSent: number;
  overdue: boolean;
}

const FILTERS = [
  { id: '', label: 'Toutes' },
  { id: 'open', label: 'À régler' },
  { id: 'paid', label: 'Réglées' },
  { id: 'void', label: 'Annulées' },
] as const;

export default function AdminInvoicesPage() {
  const [filter, setFilter] = useState<string>('');
  const [invoices, setInvoices] = useState<AdminInvoice[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const query = filter ? `?status=${filter}` : '';
      setInvoices(await api<AdminInvoice[]>(`/admin/invoices${query}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const markPaid = async (invoice: AdminInvoice): Promise<void> => {
    const reference = window.prompt(
      `Référence du règlement pour ${invoice.number} ?`,
      'Virement reçu',
    );
    if (reference === null) return;
    try {
      await api(`/admin/invoices/${invoice.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ reference }),
      });
      setMessage(`${invoice.number} marquée réglée.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Opération impossible.');
    }
  };

  const voidInvoice = async (invoice: AdminInvoice): Promise<void> => {
    if (!window.confirm(`Annuler ${invoice.number} ? Le numéro reste attribué.`)) return;
    try {
      await api(`/admin/invoices/${invoice.id}/void`, { method: 'POST' });
      setMessage(`${invoice.number} annulée.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Opération impossible.');
    }
  };

  const openPdf = async (invoice: AdminInvoice): Promise<void> => {
    const response = await fetch(`${API_URL}/invoices/${invoice.id}/pdf`, {
      headers: { authorization: `Bearer ${getToken() ?? ''}` },
    });
    if (!response.ok) {
      setMessage('Téléchargement impossible.');
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (error) return <Empty>{error}</Empty>;

  const outstanding = (invoices ?? [])
    .filter((invoice) => invoice.status === 'open')
    .reduce((acc, invoice) => acc + invoice.totalCents, 0);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <div className="row">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`btn ${filter === item.id ? 'btn-dark' : 'btn-ghost'}`}
              style={{ padding: '8px 14px', fontSize: 14 }}
              onClick={() => {
                setInvoices(null);
                setFilter(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 13.5 }}>
          En attente de règlement : {(outstanding / 100).toFixed(2).replace('.', ',')} €
        </span>
      </div>

      {message && (
        <p className="card" style={{ fontSize: 14, margin: 0 }} role="status">
          {message}
        </p>
      )}

      {!invoices && <Empty>Chargement…</Empty>}
      {invoices?.length === 0 && <Empty>Aucune facture dans cette sélection.</Empty>}

      {invoices?.map((invoice) => (
        <div key={invoice.id} className="card" style={{ padding: 16 }}>
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="row" style={{ gap: 8 }}>
                <strong style={{ fontSize: 15 }}>{invoice.number}</strong>
                <span className="muted" style={{ fontSize: 14 }}>
                  {invoice.establishmentName}
                </span>
                {invoice.overdue && <span className="badge badge-critical">En retard</span>}
                {invoice.status === 'paid' && <span className="badge badge-positive">Réglée</span>}
                {invoice.status === 'void' && <span className="badge badge-neutral">Annulée</span>}
                {invoice.remindersSent > 0 && invoice.status === 'open' && (
                  <span className="badge badge-warning">
                    {invoice.remindersSent} relance(s)
                  </span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Émise le {formatDate(invoice.issuedAt)} · échéance le {formatDate(invoice.dueAt)}
                {invoice.paidAt && ` · réglée le ${formatDate(invoice.paidAt)}`}
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <strong style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>
                {invoice.totalLabel}
              </strong>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '7px 12px', fontSize: 13.5 }}
                onClick={() => void openPdf(invoice)}
              >
                PDF
              </button>
              {invoice.status === 'open' && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '7px 12px', fontSize: 13.5 }}
                    onClick={() => void markPaid(invoice)}
                  >
                    Marquer réglée
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '7px 12px', fontSize: 13.5 }}
                    onClick={() => void voidInvoice(invoice)}
                  >
                    Annuler
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
