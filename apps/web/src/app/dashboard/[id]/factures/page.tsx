'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, ApiError, api, clearToken, getToken } from '@/lib/api';
import { Empty, formatDate } from '@/components/ui';

interface Invoice {
  id: string;
  number: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueAt: string;
  paidAt?: string;
  totalCents: number;
  totalLabel: string;
  penaltyCents: number;
  overdue: boolean;
}

interface SubscriptionInfo {
  subscription: {
    id: string;
    plan: string;
    addons: string[];
    status: string;
    startedAt: string;
    currentPeriodEnd: string;
    cancelAt?: string;
  };
  monthlyLabel: string;
  commitmentEndsAt: string | null;
}

const STATUS: Record<Invoice['status'], [string, string]> = {
  draft: ['badge-neutral', 'Brouillon'],
  open: ['badge-warning', 'À régler'],
  paid: ['badge-positive', 'Réglée'],
  void: ['badge-neutral', 'Annulée'],
  uncollectible: ['badge-critical', 'Irrécouvrable'],
};

export default function InvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const [list, subscription] = await Promise.all([
        api<Invoice[]>(`/establishments/${id}/invoices`),
        api<SubscriptionInfo>(`/establishments/${id}/subscription`).catch(() => null),
      ]);
      setInvoices(list);
      setInfo(subscription);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (): Promise<void> => {
    try {
      const outcome = await api<{ message: string }>(
        `/establishments/${id}/subscription/cancel`,
        { method: 'POST' },
      );
      setMessage(outcome.message);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Résiliation impossible.');
    }
  };

  /**
   * Le PDF est servi par l'API derrière le jeton : on ne peut pas se contenter
   * d'un lien. On le récupère, puis on ouvre l'objet local.
   */
  const openPdf = async (invoice: Invoice): Promise<void> => {
    const response = await fetch(`${API_URL}/invoices/${invoice.id}/pdf`, {
      headers: { authorization: `Bearer ${getToken() ?? ''}` },
    });
    if (!response.ok) {
      setMessage('Téléchargement de la facture impossible.');
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (error) return <Empty>{error}</Empty>;

  return (
    <div className="stack" style={{ gap: 20 }}>
      {info && (
        <section className="card">
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ fontSize: 15, marginBottom: 6 }}>Votre abonnement</h2>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge-accent">{info.subscription.plan}</span>
                <strong style={{ fontSize: 18 }}>{info.monthlyLabel}</strong>
                <span className="muted" style={{ fontSize: 13.5 }}>/ mois HT</span>
              </div>
              <div className="muted" style={{ fontSize: 13.5, marginTop: 8 }}>
                Client depuis le {formatDate(info.subscription.startedAt)} · prochaine échéance le{' '}
                {formatDate(info.subscription.currentPeriodEnd)}
                {info.commitmentEndsAt &&
                  ` · engagement jusqu’au ${formatDate(info.commitmentEndsAt)}`}
              </div>
              {info.subscription.cancelAt && (
                <div style={{ fontSize: 13.5, marginTop: 6, color: 'var(--warning)' }}>
                  Résiliation enregistrée, effective le {formatDate(info.subscription.cancelAt)}.
                </div>
              )}
            </div>
            {!info.subscription.cancelAt && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '9px 14px', fontSize: 14 }}
                onClick={() => void cancel()}
              >
                Résilier
              </button>
            )}
          </div>
        </section>
      )}

      {message && (
        <p
          className="card"
          style={{ fontSize: 14, margin: 0, background: 'var(--surface-2)' }}
          role="status"
        >
          {message}
        </p>
      )}

      <section className="stack" style={{ gap: 10 }}>
        <h2 style={{ fontSize: 15 }}>Factures</h2>
        {!invoices && <Empty>Chargement…</Empty>}
        {invoices?.length === 0 && <Empty>Aucune facture pour le moment.</Empty>}

        {invoices?.map((invoice) => {
          const [badge, label] = STATUS[invoice.status];
          return (
            <div key={invoice.id} className="card">
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{invoice.number}</strong>
                    <span className={`badge ${invoice.overdue ? 'badge-critical' : badge}`}>
                      {invoice.overdue ? 'En retard' : label}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
                    Période du {formatDate(invoice.periodStart)} au {formatDate(invoice.periodEnd)}
                    {' · '}échéance le {formatDate(invoice.dueAt)}
                    {invoice.paidAt && ` · réglée le ${formatDate(invoice.paidAt)}`}
                  </div>
                  {invoice.penaltyCents > 0 && (
                    <div style={{ fontSize: 13, marginTop: 4, color: 'var(--critical)' }}>
                      Pénalités de retard courues :{' '}
                      {(invoice.penaltyCents / 100).toFixed(2).replace('.', ',')} €
                    </div>
                  )}
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <strong style={{ fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>
                    {invoice.totalLabel}
                  </strong>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '8px 14px', fontSize: 14 }}
                    onClick={() => void openPdf(invoice)}
                  >
                    PDF
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
