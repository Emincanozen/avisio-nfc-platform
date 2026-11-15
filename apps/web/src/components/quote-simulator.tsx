'use client';

import { useMemo, useState } from 'react';
import { ADDONS, PLANS, formatEuros, quote, type AddonId, type PlanId } from '@avisio/core';

/**
 * Simulateur de devis.
 *
 * Il utilise exactement le même moteur que la facturation côté serveur
 * (`@avisio/core`), donc le prix affiché en rendez-vous est le prix facturé —
 * il n'y a pas deux barèmes à maintenir.
 */
export function QuoteSimulator() {
  const [plan, setPlan] = useState<PlanId>('pro');
  const [addons, setAddons] = useState<AddonId[]>([]);
  const [tags, setTags] = useState(3);
  const [extraPlatforms, setExtraPlatforms] = useState(1);
  const [committed, setCommitted] = useState(true);

  const result = useMemo(
    () => quote({ plan, addons, tags, extraPlatforms, committed12Months: committed }),
    [plan, addons, tags, extraPlatforms, committed],
  );

  const toggleAddon = (id: AddonId): void => {
    setAddons((current) =>
      current.includes(id) ? current.filter((a) => a !== id) : [...current, id],
    );
  };

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}
    >
      <div className="card stack" style={{ gap: 16 }}>
        <label className="stack" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 13.5 }}>
            Offre
          </span>
          <select
            className="input"
            value={plan}
            onChange={(event) => setPlan(event.target.value as PlanId)}
          >
            {(Object.keys(PLANS) as PlanId[]).map((id) => (
              <option key={id} value={id}>
                {PLANS[id].name} — {formatEuros(PLANS[id].monthlyCents)}/mois
              </option>
            ))}
          </select>
        </label>

        <div className="stack" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 13.5 }}>
            Add-ons
          </span>
          {(Object.keys(ADDONS) as AddonId[])
            .filter((id) => id !== 'extra_platform')
            .map((id) => (
              <label key={id} className="row" style={{ gap: 8, fontSize: 14.5 }}>
                <input
                  type="checkbox"
                  checked={addons.includes(id)}
                  onChange={() => toggleAddon(id)}
                />
                <span>
                  {ADDONS[id].name} — {formatEuros(ADDONS[id].monthlyCents)}/mois
                </span>
              </label>
            ))}
        </div>

        <label className="stack" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 13.5 }}>
            Plaquettes NFC : {tags}
          </span>
          <input
            type="range"
            min={1}
            max={12}
            value={tags}
            onChange={(event) => setTags(Number(event.target.value))}
          />
        </label>

        <label className="stack" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 13.5 }}>
            Plateformes en plus de Google : {extraPlatforms}
          </span>
          <input
            type="range"
            min={0}
            max={4}
            value={extraPlatforms}
            onChange={(event) => setExtraPlatforms(Number(event.target.value))}
          />
        </label>

        <label className="row" style={{ gap: 8, fontSize: 14.5 }}>
          <input
            type="checkbox"
            checked={committed}
            onChange={(event) => setCommitted(event.target.checked)}
          />
          <span>Engagement 12 mois (mise en service offerte)</span>
        </label>
      </div>

      <div className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14.5 }}>
          <tbody>
            {result.lines.map((line, index) => (
              <tr key={`${line.label}-${index}`}>
                <td style={{ padding: '7px 0' }}>
                  {line.label}
                  {line.quantity > 1 && <span className="muted"> × {line.quantity}</span>}
                  {line.kind === 'one_off' && (
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {' '}
                      (une fois)
                    </span>
                  )}
                </td>
                <td
                  style={{
                    padding: '7px 0',
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

        <hr className="sep" style={{ margin: '14px 0' }} />

        <div className="spread">
          <span>Abonnement mensuel HT</span>
          <strong style={{ fontSize: 20 }}>{formatEuros(result.monthlyCentsExclVat)}</strong>
        </div>
        <div className="spread muted" style={{ fontSize: 14 }}>
          <span>Première facture TTC</span>
          <span>{formatEuros(result.firstInvoiceCentsInclVat)}</span>
        </div>

        {result.redundantAddons.length > 0 && (
          <p
            style={{
              fontSize: 13.5,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              padding: '10px 12px',
              borderRadius: 8,
              marginBottom: 0,
            }}
          >
            Déjà compris dans l’offre, non facturé :{' '}
            {result.redundantAddons.map((id) => ADDONS[id].name).join(', ')}.
          </p>
        )}
      </div>
    </div>
  );
}
