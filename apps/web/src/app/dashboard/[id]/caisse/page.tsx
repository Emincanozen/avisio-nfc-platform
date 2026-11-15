'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, clearToken } from '@/lib/api';
import { Empty, Kpi, relativeDays } from '@/components/ui';

interface PosStatus {
  entitled: boolean;
  configured: boolean;
  vendor: string | null;
  lastUsedAt: string | null;
  webhookUrl: string;
  stats: {
    tickets: number;
    invitationsSent: number;
    inviteRate: number;
    averageTicketCents: number;
  };
}

interface Ticket {
  id: string;
  externalId: string;
  closedAt: string;
  totalCents: number;
  reference: string | null;
  hasContact: boolean;
  invitedAt: string | null;
}

const VENDORS = [
  ['generic', 'Autre / développement sur mesure'],
  ['lightspeed', 'Lightspeed'],
  ['zelty', 'Zelty'],
  ['tiller', 'Tiller'],
  ['square', 'Square'],
] as const;

export default function PosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [status, setStatus] = useState<PosStatus | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [vendor, setVendor] = useState<string>('generic');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const posStatus = await api<PosStatus>(`/establishments/${id}/pos`);
      setStatus(posStatus);
      if (posStatus.vendor) setVendor(posStatus.vendor);
      if (posStatus.entitled) {
        setTickets(await api<Ticket[]>(`/establishments/${id}/pos/tickets`));
      }
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

  const generate = async (): Promise<void> => {
    try {
      const result = await api<{ secret: string }>(`/establishments/${id}/pos/credential`, {
        method: 'POST',
        body: JSON.stringify({ vendor }),
      });
      setSecret(result.secret);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Génération impossible.');
    }
  };

  if (error) return <Empty>{error}</Empty>;
  if (!status) return <Empty>Chargement…</Empty>;

  if (!status.entitled) {
    return (
      <Empty>
        L’intégration caisse est comprise dans l’offre Premium. Elle envoie une
        invitation à déposer un avis après chaque ticket clôturé, et imprime le
        lien sur le ticket de caisse.
      </Empty>
    );
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="kpi">
        <Kpi label="Tickets reçus (30 j)" value={String(status.stats.tickets)} />
        <Kpi
          label="Invitations envoyées"
          value={String(status.stats.invitationsSent)}
          hint={`${Math.round(status.stats.inviteRate * 100)} % des tickets`}
        />
        <Kpi
          label="Panier moyen"
          value={`${(status.stats.averageTicketCents / 100).toFixed(2).replace('.', ',')} €`}
          hint="donnée transmise par la caisse"
        />
        <Kpi
          label="Dernier appel"
          value={status.lastUsedAt ? relativeDays(status.lastUsedAt) : '—'}
          tone={status.lastUsedAt ? 'positive' : 'warning'}
        />
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>Connexion de la caisse</h2>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>
          Votre caisse envoie chaque ticket clôturé à cette adresse. L’invitation
          part deux heures après la clôture — le temps que le client soit
          reparti — et jamais plus d’une fois par mois pour un même client.
        </p>

        <div className="stack" style={{ gap: 10 }}>
          <label className="stack" style={{ gap: 5 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Adresse du webhook
            </span>
            <code
              style={{
                background: 'var(--surface-2)',
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 13,
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              POST {status.webhookUrl}
            </code>
          </label>

          <div className="row">
            <select
              className="input"
              style={{ width: 260 }}
              value={vendor}
              onChange={(event) => setVendor(event.target.value)}
            >
              {VENDORS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-dark"
              onClick={() => void generate()}
              style={{ padding: '10px 16px', fontSize: 14 }}
            >
              {status.configured ? 'Régénérer la clé' : 'Générer la clé'}
            </button>
          </div>

          {secret && (
            <div
              className="card"
              style={{ background: 'var(--accent-soft)', borderColor: 'transparent' }}
            >
              <strong style={{ fontSize: 14 }}>
                Notez cette clé : elle ne sera plus affichée.
              </strong>
              <code
                style={{
                  display: 'block',
                  marginTop: 8,
                  fontSize: 13.5,
                  wordBreak: 'break-all',
                }}
              >
                {secret}
              </code>
            </div>
          )}

          <details style={{ fontSize: 13.5 }}>
            <summary style={{ cursor: 'pointer' }}>Format attendu par l’API</summary>
            <pre
              style={{
                background: 'var(--surface-2)',
                padding: 12,
                borderRadius: 8,
                overflowX: 'auto',
                fontSize: 12.5,
                lineHeight: 1.5,
              }}
            >{`En-têtes
  x-avisio-timestamp : horodatage Unix en secondes
  x-avisio-signature : HMAC-SHA256 de "<timestamp>.<corps JSON>"

Corps
{
  "externalId": "TCK-4218",
  "closedAt": "2026-09-17T12:31:00.000Z",
  "totalCents": 4250,
  "contact": "client@exemple.fr",
  "contactChannel": "email",
  "reference": "Table 7"
}`}</pre>
            <p className="muted" style={{ fontSize: 12.5 }}>
              La fenêtre de validité de la signature est de 5 minutes. Un ticket
              renvoyé deux fois n’est jamais compté ni invité deux fois.
            </p>
          </details>
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <h2 style={{ fontSize: 15 }}>Derniers tickets</h2>
        {tickets.length === 0 && <Empty>Aucun ticket reçu sur les 30 derniers jours.</Empty>}
        {tickets.slice(0, 15).map((ticket) => (
          <div key={ticket.id} className="card" style={{ padding: 14 }}>
            <div className="spread">
              <div>
                <strong style={{ fontSize: 14.5 }}>{ticket.externalId}</strong>
                <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>
                  {ticket.reference ?? '—'} · {relativeDays(ticket.closedAt)}
                </span>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <span style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  {(ticket.totalCents / 100).toFixed(2).replace('.', ',')} €
                </span>
                <span
                  className={`badge ${
                    ticket.invitedAt
                      ? 'badge-positive'
                      : ticket.hasContact
                        ? 'badge-warning'
                        : 'badge-neutral'
                  }`}
                >
                  {ticket.invitedAt
                    ? 'Invité'
                    : ticket.hasContact
                      ? 'En attente'
                      : 'Sans contact'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
