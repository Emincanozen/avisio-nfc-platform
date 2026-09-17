'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, clearToken } from '@/lib/api';
import { currentState, sendTest, subscribe, unsubscribe, type PushState } from '@/lib/push';
import { Empty } from '@/components/ui';

type Channel = 'email' | 'push';
type EventKey =
  | 'negative_review'
  | 'theme_trend'
  | 'weekly_digest'
  | 'monthly_report'
  | 'billing';

interface Preferences {
  establishmentId: string;
  channels: Record<EventKey, Channel[]>;
  quietHours: { start: number; end: number } | null;
  utcOffsetHours: number;
}

const EVENTS: Array<{ key: EventKey; label: string; hint: string; locked?: boolean }> = [
  {
    key: 'negative_review',
    label: 'Avis négatif publié',
    hint: 'Dès qu’un avis de 1 à 3 étoiles paraît sur une plateforme connectée.',
  },
  {
    key: 'theme_trend',
    label: 'Tendance détectée',
    hint: 'Quand un sujet monte nettement par rapport aux semaines précédentes.',
  },
  {
    key: 'weekly_digest',
    label: 'Résumé hebdomadaire',
    hint: 'Le lundi matin : volume, note, avis en attente de réponse.',
  },
  {
    key: 'monthly_report',
    label: 'Rapport mensuel',
    hint: 'Le 1er du mois, avec le PDF à transmettre à votre équipe.',
  },
  {
    key: 'billing',
    label: 'Factures et relances',
    hint: 'Messages contractuels : ils ne peuvent pas être désactivés.',
    locked: true,
  },
];

const PUSH_LABELS: Record<PushState, string> = {
  unsupported: 'Ce navigateur ne gère pas les notifications push.',
  'server-disabled': 'Le serveur n’a pas de clés VAPID configurées : les push sont journalisés.',
  denied: 'Les notifications sont bloquées pour ce site dans les réglages du navigateur.',
  subscribed: 'Cet appareil recevra les alertes.',
  available: 'Activez les alertes sur cet appareil.',
};

export default function NotificationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setPrefs(await api<Preferences>(`/establishments/${id}/notifications`));
      setPushState(await currentState());
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

  const save = async (next: Preferences): Promise<void> => {
    setPrefs(next);
    setSaving(true);
    try {
      await api(`/establishments/${id}/notifications`, {
        method: 'PUT',
        body: JSON.stringify({
          channels: next.channels,
          quietHours: next.quietHours,
          utcOffsetHours: next.utcOffsetHours,
        }),
      });
      setMessage('Préférences enregistrées.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (event: EventKey, channel: Channel): void => {
    if (!prefs) return;
    const current = prefs.channels[event] ?? [];
    const next = current.includes(channel)
      ? current.filter((c) => c !== channel)
      : [...current, channel];
    void save({ ...prefs, channels: { ...prefs.channels, [event]: next } });
  };

  if (error) return <Empty>{error}</Empty>;
  if (!prefs) return <Empty>Chargement…</Empty>;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card">
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>Alertes sur cet appareil</h2>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>
          {pushState ? PUSH_LABELS[pushState] : 'Vérification…'}
        </p>
        <div className="row">
          {pushState === 'available' && (
            <button
              type="button"
              className="btn btn-dark"
              style={{ padding: '10px 16px', fontSize: 14 }}
              onClick={async () => setPushState(await subscribe())}
            >
              Activer les notifications
            </button>
          )}
          {pushState === 'subscribed' && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '10px 16px', fontSize: 14 }}
                onClick={async () => {
                  const delivered = await sendTest();
                  setMessage(
                    delivered > 0
                      ? 'Notification de test envoyée.'
                      : 'Aucun appareil enregistré pour ce compte.',
                  );
                }}
              >
                Envoyer un test
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '10px 16px', fontSize: 14 }}
                onClick={async () => {
                  await unsubscribe();
                  setPushState('available');
                }}
              >
                Désactiver sur cet appareil
              </button>
            </>
          )}
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0, marginTop: 12 }}>
          Ajoutez Avisio à votre écran d’accueil depuis le menu de partage de votre
          navigateur pour recevoir les alertes comme une application.
        </p>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>Ce qui vous est notifié</h2>
        <div className="stack" style={{ gap: 14 }}>
          {EVENTS.map((event) => {
            const channels = prefs.channels[event.key] ?? [];
            return (
              <div key={event.key} className="spread" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <strong style={{ fontSize: 14.5 }}>{event.label}</strong>
                  <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>
                    {event.hint}
                  </p>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {(['email', 'push'] as Channel[]).map((channel) => {
                    const active = channels.includes(channel);
                    return (
                      <button
                        key={channel}
                        type="button"
                        className={`btn ${active ? 'btn-dark' : 'btn-ghost'}`}
                        style={{ padding: '7px 13px', fontSize: 13.5 }}
                        disabled={event.locked || saving}
                        onClick={() => toggle(event.key, channel)}
                      >
                        {channel === 'email' ? 'E-mail' : 'Push'}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>Heures calmes</h2>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>
          Pendant cette plage, les notifications push sont retenues et partent à la
          première heure. Les e-mails, eux, arrivent normalement.
        </p>

        <label className="row" style={{ gap: 8, fontSize: 14.5, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={prefs.quietHours !== null}
            onChange={(e) =>
              void save({
                ...prefs,
                quietHours: e.target.checked ? { start: 22, end: 8 } : null,
              })
            }
          />
          <span>Activer les heures calmes</span>
        </label>

        {prefs.quietHours && (
          <div className="row" style={{ gap: 12 }}>
            {(['start', 'end'] as const).map((bound) => (
              <label key={bound} className="stack" style={{ gap: 4 }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  {bound === 'start' ? 'De' : 'À'}
                </span>
                <select
                  className="input"
                  style={{ width: 110 }}
                  value={prefs.quietHours![bound]}
                  onChange={(e) =>
                    void save({
                      ...prefs,
                      quietHours: { ...prefs.quietHours!, [bound]: Number(e.target.value) },
                    })
                  }
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {String(hour).padStart(2, '0')} h
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </section>

      {message && (
        <p className="muted" style={{ fontSize: 13.5 }} role="status">
          {message}
        </p>
      )}
    </div>
  );
}
