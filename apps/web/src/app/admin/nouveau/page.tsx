'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ADDONS, PLANS, formatEuros, quote, type AddonId, type PlanId } from '@avisio/core';
import { api } from '@/lib/api';

interface CreatedTag {
  id: string;
  label: string;
  slug: string;
  url: string;
}

interface OnboardingResult {
  establishment: { id: string; name: string };
  manager: { email: string };
  invoice: { number: string; totalLabel: string };
  tags: CreatedTag[];
}

const SECTORS = [
  ['restaurant', 'Restaurant'],
  ['bar', 'Bar / café'],
  ['hotel', 'Hôtel'],
  ['retail', 'Commerce de détail'],
  ['beauty', 'Beauté / coiffure'],
  ['health', 'Santé'],
  ['other', 'Autre'],
] as const;

/**
 * Parcours d'onboarding déroulé par le commercial devant le client.
 *
 * Un seul écran, un seul appel : à la fin, l'établissement existe, le gérant
 * peut se connecter, les plaquettes ont leur URL et la première facture est
 * émise. C'est ce qui permet de signer et d'installer dans la même visite.
 */
export default function NewEstablishmentPage() {
  const [name, setName] = useState('');
  const [sector, setSector] = useState<string>('restaurant');
  const [postalCode, setPostalCode] = useState('');
  const [nafCode, setNafCode] = useState('');
  const [brandTone, setBrandTone] = useState(
    'chaleureux et direct, vouvoiement, jamais corporate',
  );
  const [googleReviewUrl, setGoogleReviewUrl] = useState('');

  const [plan, setPlan] = useState<PlanId>('pro');
  const [addons, setAddons] = useState<AddonId[]>([]);
  const [extraPlatforms, setExtraPlatforms] = useState(1);
  const [tags, setTags] = useState(3);
  const [committed, setCommitted] = useState(true);
  const [tagLabels, setTagLabels] = useState('Comptoir, Addition');

  const [managerName, setManagerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<OnboardingResult | null>(null);

  // Le devis utilise le moteur du domaine : le prix montré au client au
  // moment de signer est exactement celui qui sera facturé.
  const devis = useMemo(
    () => quote({ plan, addons, tags, extraPlatforms, committed12Months: committed }),
    [plan, addons, tags, extraPlatforms, committed],
  );

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        establishment: {
          name: name.trim(),
          sector,
          postalCode: postalCode.trim(),
          ...(nafCode.trim() ? { nafCode: nafCode.trim() } : {}),
          brandTone: brandTone.trim(),
          defaultLocale: 'fr',
        },
        subscription: { plan, addons, extraPlatforms, tags, committed12Months: committed },
        manager: { name: managerName.trim(), email: email.trim(), password },
        googleReviewUrl: googleReviewUrl.trim(),
        tagLabels: tagLabels
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean),
      };
      setResult(await api<OnboardingResult>('/admin/establishments', {
        method: 'POST',
        body: JSON.stringify(payload),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="stack" style={{ gap: 16 }}>
        <div className="card" style={{ background: 'var(--positive-soft)', borderColor: 'transparent' }}>
          <h2 style={{ fontSize: 17, marginBottom: 6 }}>
            {result.establishment.name} est en service
          </h2>
          <p style={{ fontSize: 14.5, margin: 0 }}>
            Le gérant peut se connecter avec <strong>{result.manager.email}</strong>.
            Première facture : {result.invoice.number} — {result.invoice.totalLabel}.
          </p>
        </div>

        <section className="card">
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>
            URL à encoder sur les plaquettes
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Une puce NTAG213 par emplacement, en enregistrement NDEF de type URI,
            puis verrouillage en lecture seule avant la pose.
          </p>
          <div className="stack" style={{ gap: 8 }}>
            {result.tags.map((tag) => (
              <div key={tag.id} className="row" style={{ gap: 8 }}>
                <span style={{ fontSize: 14, minWidth: 130 }}>{tag.label}</span>
                <code
                  style={{
                    flex: 1,
                    background: 'var(--surface-2)',
                    padding: '8px 10px',
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  {tag.url}
                </code>
                <a
                  className="btn btn-ghost"
                  style={{ padding: '7px 12px', fontSize: 13.5 }}
                  href={tag.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Tester
                </a>
              </div>
            ))}
          </div>
        </section>

        <div className="row">
          <Link
            href={`/dashboard/${result.establishment.id}`}
            className="btn btn-dark"
            style={{ padding: '10px 16px', fontSize: 14 }}
          >
            Ouvrir le tableau de bord
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '10px 16px', fontSize: 14 }}
            onClick={() => {
              setResult(null);
              setName('');
              setPostalCode('');
              setGoogleReviewUrl('');
              setManagerName('');
              setEmail('');
              setPassword('');
            }}
          >
            Créer un autre établissement
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}
      onSubmit={submit}
    >
      <div className="stack" style={{ gap: 16 }}>
        <section className="card stack" style={{ gap: 12 }}>
          <h2 style={{ fontSize: 15 }}>Établissement</h2>

          <Field label="Nom commercial">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Le Comptoir des Minimes"
              required
            />
          </Field>

          <div className="row" style={{ gap: 10 }}>
            <Field label="Secteur" style={{ flex: 1, minWidth: 150 }}>
              <select
                className="input"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              >
                {SECTORS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Code postal" style={{ width: 130 }}>
              <input
                className="input"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="31200"
                inputMode="numeric"
                required
              />
            </Field>
            <Field label="Code NAF" style={{ width: 120 }}>
              <input
                className="input"
                value={nafCode}
                onChange={(e) => setNafCode(e.target.value)}
                placeholder="5610A"
              />
            </Field>
          </div>

          <Field label="URL de dépôt d’avis Google">
            <input
              className="input"
              value={googleReviewUrl}
              onChange={(e) => setGoogleReviewUrl(e.target.value)}
              placeholder="https://g.page/r/…/review"
              type="url"
              required
            />
          </Field>

          <Field label="Ton de marque (pour les réponses suggérées)">
            <textarea
              className="input"
              style={{ minHeight: 70 }}
              value={brandTone}
              onChange={(e) => setBrandTone(e.target.value)}
            />
          </Field>
        </section>

        <section className="card stack" style={{ gap: 12 }}>
          <h2 style={{ fontSize: 15 }}>Compte du gérant</h2>
          <Field label="Nom">
            <input
              className="input"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              required
            />
          </Field>
          <Field label="E-mail">
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Mot de passe provisoire (8 caractères minimum)">
            <input
              className="input"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </Field>
        </section>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <section className="card stack" style={{ gap: 12 }}>
          <h2 style={{ fontSize: 15 }}>Offre</h2>

          <div className="row" style={{ gap: 8 }}>
            {(Object.keys(PLANS) as PlanId[]).map((value) => (
              <button
                key={value}
                type="button"
                className={`btn ${plan === value ? 'btn-dark' : 'btn-ghost'}`}
                style={{ padding: '8px 14px', fontSize: 14 }}
                onClick={() => {
                  setPlan(value);
                  setTags(PLANS[value].includedTags);
                }}
              >
                {PLANS[value].name}
              </button>
            ))}
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Add-ons
            </span>
            {(Object.keys(ADDONS) as AddonId[])
              .filter((id) => id !== 'extra_platform')
              .map((id) => (
                <label key={id} className="row" style={{ gap: 8, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={addons.includes(id)}
                    onChange={() =>
                      setAddons((current) =>
                        current.includes(id)
                          ? current.filter((a) => a !== id)
                          : [...current, id],
                      )
                    }
                  />
                  <span>
                    {ADDONS[id].name} — {formatEuros(ADDONS[id].monthlyCents)}/mois
                  </span>
                </label>
              ))}
          </div>

          <Field label={`Plaquettes : ${tags}`}>
            <input
              type="range"
              min={1}
              max={12}
              value={tags}
              onChange={(e) => setTags(Number(e.target.value))}
            />
          </Field>

          <Field label={`Plateformes en plus de Google : ${extraPlatforms}`}>
            <input
              type="range"
              min={0}
              max={4}
              value={extraPlatforms}
              onChange={(e) => setExtraPlatforms(Number(e.target.value))}
            />
          </Field>

          <Field label="Emplacements des plaquettes (séparés par des virgules)">
            <input
              className="input"
              value={tagLabels}
              onChange={(e) => setTagLabels(e.target.value)}
              placeholder="Comptoir, Addition, Terrasse"
            />
          </Field>

          <label className="row" style={{ gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={committed}
              onChange={(e) => setCommitted(e.target.checked)}
            />
            <span>Engagement 12 mois (mise en service offerte)</span>
          </label>
        </section>

        <section className="card">
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>Première facture</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {devis.lines.map((line, index) => (
                <tr key={`${line.label}-${index}`}>
                  <td style={{ padding: '5px 0' }}>
                    {line.label}
                    {line.quantity > 1 && <span className="muted"> × {line.quantity}</span>}
                  </td>
                  <td
                    style={{
                      padding: '5px 0',
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatEuros(line.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <hr className="sep" style={{ margin: '12px 0' }} />
          <div className="spread">
            <span>Abonnement mensuel HT</span>
            <strong style={{ fontSize: 18 }}>{formatEuros(devis.monthlyCentsExclVat)}</strong>
          </div>
          <div className="spread muted" style={{ fontSize: 14 }}>
            <span>Première facture TTC</span>
            <span>{formatEuros(devis.firstInvoiceCentsInclVat)}</span>
          </div>

          {devis.redundantAddons.length > 0 && (
            <p
              style={{
                fontSize: 13,
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                padding: '9px 11px',
                borderRadius: 8,
                marginBottom: 0,
              }}
            >
              Déjà compris dans l’offre, non facturé :{' '}
              {devis.redundantAddons.map((id) => ADDONS[id].name).join(', ')}.
            </p>
          )}

          {error && (
            <p style={{ color: 'var(--critical)', fontSize: 14 }} role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 14 }}
            disabled={busy}
          >
            {busy ? 'Création…' : 'Créer et facturer'}
          </button>
        </section>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <label className="stack" style={{ gap: 5, ...style }}>
      <span className="muted" style={{ fontSize: 13 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
