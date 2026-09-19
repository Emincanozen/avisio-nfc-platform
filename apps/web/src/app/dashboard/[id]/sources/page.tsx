'use client';

/**
 * Sources d'avis : d'où viennent les avis que le produit surveille.
 *
 * L'écran doit répondre à une seule question, et y répondre sans ambiguïté :
 * « mes avis Google remontent-ils, oui ou non ». Un état vague — un bandeau
 * vert par défaut, un silence en cas de panne — serait pire qu'un message
 * d'échec : le gérant se croirait couvert sans l'être.
 */

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, clearToken } from '@/lib/api';
import { Empty, relativeDays } from '@/components/ui';

interface GoogleStatus {
  available: boolean;
  connected: boolean;
  locationSelected: boolean;
  locationName?: string | null;
  locationTitle?: string | null;
  connectedAt?: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
  scope: string;
  redirectUri: string;
}

interface GoogleLocation {
  name: string;
  title: string;
  address?: string;
  placeId?: string;
}

interface ImportRejection {
  line: number;
  reason: string;
}

interface ImportResult {
  dryRun: boolean;
  summary: {
    platformLabel: string;
    read: number;
    imported: number;
    duplicates: number;
    rejected: ImportRejection[];
  };
  alertsCreated?: number;
  message: string;
  preview?: Array<{ author: string; rating: number; comment: string; publishedAt: string }>;
}

const PLATFORMS = [
  ['google', 'Google'],
  ['tripadvisor', 'TripAdvisor'],
  ['facebook', 'Facebook'],
  ['yelp', 'Yelp'],
  ['thefork', 'TheFork'],
] as const;

/** Traduit le motif technique renvoyé par le retour OAuth. */
const CALLBACK_MESSAGES: Record<string, string> = {
  'reponse-incomplete': 'Google a renvoyé une réponse incomplète. Recommencez la connexion.',
  'etat-invalide': 'La demande a expiré. Relancez la connexion depuis cette page.',
  'sans-jeton-durable':
    "Google n'a pas fourni d'autorisation durable. Retirez l'accès d'Avisio dans votre compte Google, puis reconnectez.",
  'echange-refuse': "Google a refusé l'échange. Vérifiez que l'accès API est bien accordé.",
};

export default function SourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const search = useSearchParams();

  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [locations, setLocations] = useState<GoogleLocation[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [diagnostic, setDiagnostic] = useState<{ ok: boolean; etape: string; message: string } | null>(
    null,
  );

  const [platform, setPlatform] = useState<string>('google');
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await api<GoogleStatus>(`/establishments/${id}/google`));
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

  // Message de retour du parcours OAuth, porté par l'URL.
  useEffect(() => {
    const outcome = search.get('google');
    if (!outcome) return;
    if (outcome === 'connecte') setNotice('Compte Google connecté. Choisissez votre fiche.');
    else if (outcome === 'annule') setNotice('Connexion annulée.');
    else setError(CALLBACK_MESSAGES[search.get('motif') ?? ''] ?? 'La connexion Google a échoué.');
  }, [search]);

  const connect = async (): Promise<void> => {
    setBusy('connect');
    setError('');
    try {
      const { url } = await api<{ url: string }>(`/establishments/${id}/google/authorize`, {
        method: 'POST',
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
      setBusy('');
    }
  };

  const loadLocations = async (): Promise<void> => {
    setBusy('locations');
    setError('');
    try {
      const data = await api<{ locations: GoogleLocation[] }>(
        `/establishments/${id}/google/locations`,
      );
      setLocations(data.locations);
      if (data.locations.length === 0) {
        setError('Aucune fiche trouvée sur ce compte Google.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fiches indisponibles.');
    } finally {
      setBusy('');
    }
  };

  const selectLocation = async (location: GoogleLocation): Promise<void> => {
    setBusy(location.name);
    try {
      await api(`/establishments/${id}/google/location`, {
        method: 'PUT',
        body: JSON.stringify({ locationName: location.name, locationTitle: location.title }),
      });
      setLocations(null);
      setNotice(`Fiche « ${location.title} » rattachée.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rattachement impossible.');
    } finally {
      setBusy('');
    }
  };

  const test = async (): Promise<void> => {
    setBusy('test');
    setDiagnostic(null);
    try {
      setDiagnostic(
        await api<{ ok: boolean; etape: string; message: string }>(
          `/establishments/${id}/google/test`,
          { method: 'POST' },
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test impossible.');
    } finally {
      setBusy('');
    }
  };

  const disconnect = async (): Promise<void> => {
    if (!window.confirm('Retirer l’accès Avisio à votre fiche Google ?')) return;
    setBusy('disconnect');
    try {
      await api(`/establishments/${id}/google`, { method: 'DELETE' });
      setLocations(null);
      setDiagnostic(null);
      setNotice('Accès Google retiré.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Déconnexion impossible.');
    } finally {
      setBusy('');
    }
  };

  const runImport = async (dryRun: boolean): Promise<void> => {
    if (csv.trim().length === 0) return;
    setBusy(dryRun ? 'preview' : 'import');
    setError('');
    try {
      setResult(
        await api<ImportResult>(`/establishments/${id}/reviews/import`, {
          method: 'POST',
          body: JSON.stringify({ platform, csv, dryRun }),
        }),
      );
      if (!dryRun) setCsv('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import impossible.');
    } finally {
      setBusy('');
    }
  };

  const readFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ''));
      setResult(null);
    };
    reader.readAsText(file, 'utf-8');
  };

  if (!status) return <Empty>Chargement…</Empty>;

  return (
    <div className="stack" style={{ gap: 20 }}>
      {notice && (
        <div className="card" style={{ borderLeft: '3px solid var(--positive)' }}>
          <span style={{ fontSize: 14 }}>{notice}</span>
        </div>
      )}
      {error && (
        <div className="card" style={{ borderLeft: '3px solid var(--critical)' }}>
          <span style={{ fontSize: 14 }}>{error}</span>
        </div>
      )}

      {/* ---- Google ---- */}
      <section className="card">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 15, marginBottom: 4 }}>Google Business Profile</h2>
            <p className="muted" style={{ fontSize: 13.5, margin: 0, maxWidth: 560 }}>
              Autorisez Avisio à lire les avis de votre fiche pour être alerté des
              avis négatifs et y répondre depuis cet espace. Vous pouvez retirer
              cet accès à tout moment, ici ou depuis votre compte Google.
            </p>
          </div>
          <StatusBadge status={status} />
        </div>

        {!status.available && (
          <p className="muted" style={{ fontSize: 13.5, marginTop: 14 }}>
            La connexion Google n’est pas encore activée sur cette instance
            d’Avisio. En attendant, utilisez l’import ci-dessous : il alimente le
            produit avec vos avis réels, exportés depuis votre fiche.
          </p>
        )}

        {status.connected && (
          <dl
            className="grid"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              marginTop: 16,
            }}
          >
            <Field label="Fiche rattachée" value={status.locationTitle ?? 'aucune'} />
            <Field
              label="Autorisée"
              value={status.connectedAt ? relativeDays(status.connectedAt) : '—'}
            />
            <Field
              label="Dernière synchronisation"
              value={status.lastSyncAt ? relativeDays(status.lastSyncAt) : 'jamais'}
            />
          </dl>
        )}

        {status.lastError && (
          <div
            className="card"
            style={{ marginTop: 14, borderLeft: '3px solid var(--critical)', background: 'var(--surface-2)' }}
          >
            <strong style={{ fontSize: 14 }}>La synchronisation ne passe plus</strong>
            <p className="muted" style={{ fontSize: 13.5, margin: '6px 0 0' }}>
              {status.lastError}
            </p>
          </div>
        )}

        <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
          {status.available && !status.connected && (
            <button type="button" className="btn btn-dark" disabled={busy === 'connect'} onClick={connect}>
              {busy === 'connect' ? 'Redirection…' : 'Connecter Google'}
            </button>
          )}
          {status.connected && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy === 'locations'}
                onClick={loadLocations}
              >
                {busy === 'locations'
                  ? 'Chargement…'
                  : status.locationSelected
                    ? 'Changer de fiche'
                    : 'Choisir ma fiche'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy === 'test'} onClick={test}>
                {busy === 'test' ? 'Test en cours…' : 'Tester la connexion'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy === 'disconnect'}
                onClick={disconnect}
              >
                Retirer l’accès
              </button>
            </>
          )}
        </div>

        {diagnostic && (
          <div
            className="card"
            style={{
              marginTop: 14,
              background: 'var(--surface-2)',
              borderLeft: `3px solid ${diagnostic.ok ? 'var(--positive)' : 'var(--critical)'}`,
            }}
          >
            <strong style={{ fontSize: 14 }}>
              {diagnostic.ok ? 'Connexion opérationnelle' : `Blocage à l’étape « ${diagnostic.etape} »`}
            </strong>
            <p className="muted" style={{ fontSize: 13.5, margin: '6px 0 0' }}>
              {diagnostic.message}
            </p>
          </div>
        )}

        {locations && locations.length > 0 && (
          <div className="stack" style={{ marginTop: 16, gap: 8 }}>
            <h3 style={{ fontSize: 14 }}>Fiches gérées par ce compte</h3>
            {locations.map((location) => (
              <div key={location.name} className="spread card" style={{ background: 'var(--surface-2)' }}>
                <div>
                  <strong style={{ fontSize: 14.5 }}>{location.title}</strong>
                  {location.address && (
                    <div className="muted" style={{ fontSize: 13 }}>
                      {location.address}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-dark"
                  style={{ padding: '8px 14px', fontSize: 14 }}
                  disabled={busy === location.name}
                  onClick={() => void selectLocation(location)}
                >
                  {status.locationName === location.name ? 'Rattachée' : 'Rattacher'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Import manuel ---- */}
      <section className="card">
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>Importer des avis</h2>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 0, maxWidth: 620 }}>
          Chargez un export de votre plateforme. Les avis importés sont analysés
          comme les autres, et restent identifiés comme importés — jamais
          présentés comme le fruit d’une synchronisation en direct.
        </p>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <select
            className="input"
            style={{ width: 200 }}
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
          >
            {PLATFORMS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="file"
            accept=".csv,text/csv"
            className="input"
            style={{ flex: 1, minWidth: 220 }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readFile(file);
            }}
          />
          <a
            className="btn btn-ghost"
            style={{ padding: '9px 14px', fontSize: 14 }}
            href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/establishments/${id}/reviews/import/template`}
          >
            Modèle CSV
          </a>
        </div>

        <textarea
          className="input"
          style={{ width: '100%', minHeight: 120, marginTop: 10, fontFamily: 'monospace', fontSize: 13 }}
          placeholder="externalId,author,rating,comment,publishedAt,replyText"
          value={csv}
          onChange={(event) => {
            setCsv(event.target.value);
            setResult(null);
          }}
        />

        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy !== '' || csv.trim() === ''}
            onClick={() => void runImport(true)}
          >
            {busy === 'preview' ? 'Analyse…' : 'Prévisualiser'}
          </button>
          <button
            type="button"
            className="btn btn-dark"
            disabled={busy !== '' || csv.trim() === ''}
            onClick={() => void runImport(false)}
          >
            {busy === 'import' ? 'Import…' : 'Importer'}
          </button>
        </div>

        {result && (
          <div className="card" style={{ marginTop: 14, background: 'var(--surface-2)' }}>
            <strong style={{ fontSize: 14 }}>
              {result.dryRun ? 'Prévisualisation — rien n’a été enregistré' : 'Import terminé'}
            </strong>
            <p style={{ fontSize: 14, margin: '6px 0 0' }}>{result.message}</p>
            {result.alertsCreated != null && result.alertsCreated > 0 && (
              <p className="muted" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
                {result.alertsCreated} alerte(s) créée(s) sur les avis négatifs récents.
              </p>
            )}

            {result.summary.rejected.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
                  Lignes refusées
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                  {result.summary.rejected.slice(0, 12).map((rejection) => (
                    <li key={rejection.line}>
                      Ligne {rejection.line} — {rejection.reason}
                    </li>
                  ))}
                </ul>
                {result.summary.rejected.length > 12 && (
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    et {result.summary.rejected.length - 12} autre(s).
                  </div>
                )}
              </div>
            )}

            {result.preview && result.preview.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
                  Aperçu
                </div>
                {result.preview.map((row) => (
                  <div key={`${row.author}-${row.publishedAt}`} style={{ fontSize: 13.5 }}>
                    {row.rating}★ · {row.author} — {row.comment.slice(0, 80)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Pastille d'état.
 *
 * Trois états seulement, et aucun qui laisse croire que tout va bien par
 * défaut : non connecté, connecté mais incomplet, opérationnel.
 */
function StatusBadge({ status }: { status: GoogleStatus }) {
  if (status.lastError) return <span className="badge badge-critical">Synchronisation rompue</span>;
  if (!status.connected) return <span className="badge">Non connecté</span>;
  if (!status.locationSelected) return <span className="badge badge-warning">Fiche à choisir</span>;
  return <span className="badge badge-positive">Connecté</span>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="kpi-label">{label}</div>
      <div style={{ fontSize: 14.5 }}>{value}</div>
    </div>
  );
}
