/**
 * Landing page NFC.
 *
 * Rendue côté serveur, sans JavaScript bloquant, sans police distante, sans
 * image : le budget est de moins d'une seconde sur un réseau mobile moyen,
 * dans une salle de restaurant où la 4G passe mal.
 *
 * Elle ne demande jamais la note avant la redirection : le client tape une
 * fois, et part sur la plateforme. Toute autre variante serait du review
 * gating (cf. packages/core/src/compliance.ts).
 */

import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/api';
import type { LandingPayload } from '@/lib/types';
import { ScanButton } from './scan-button';
import { LoyaltyForm } from './loyalty-form';

export const dynamic = 'force-dynamic';

export default async function NfcLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const headerList = await headers();

  const data = await serverApi<LandingPayload>(`/public/tag/${slug}`, {
    headers: {
      // La langue du téléphone du client est transmise telle quelle : c'est
      // elle qui décide de la langue de la page, pas une IP ni un cookie.
      'accept-language': headerList.get('accept-language') ?? 'fr',
    },
  });

  if (!data) notFound();

  const subtitle = data.messages.subtitle.replace(
    '{establishment}',
    data.establishment.name,
  );

  /**
   * Établissement dont aucune plateforme n'est active.
   *
   * La plaquette existe et fonctionne : c'est la configuration qui manque.
   * Le client, lui, est debout au comptoir avec son téléphone — il mérite une
   * page dans sa langue, au nom de l'établissement, qui lui dit simplement
   * qu'il n'y a rien à faire. Pas un écran d'erreur, qui lui laisserait
   * croire que l'établissement est en panne.
   */
  if (!data.configured || !data.platform) {
    return (
      <main className="nfc" lang={data.locale}>
        <div className="eyebrow">{data.establishment.name}</div>
        <h1>{data.messages.title}</h1>
        <p className="muted" style={{ marginTop: 0, fontSize: 16 }}>
          {data.messages.notConfigured}
        </p>
        <p className="disclosure" style={{ marginTop: 28, opacity: 0.7 }}>
          {data.messages.poweredBy}
        </p>
      </main>
    );
  }

  const cta = data.messages.cta.replace('{platform}', data.platform.label);

  return (
    <main className="nfc" lang={data.locale}>
      <div className="eyebrow">{data.establishment.name}</div>
      <h1>{data.messages.title}</h1>
      <p className="muted" style={{ marginTop: 0, fontSize: 16 }}>
        {subtitle}
      </p>

      <div style={{ marginTop: 28 }}>
        <ScanButton
          slug={slug}
          label={cta}
          redirectingLabel={data.messages.redirecting.replace(
            '{platform}',
            data.platform.label,
          )}
          errorLabel={data.messages.error}
        />
      </div>

      {data.loyaltyEnabled && (
        <LoyaltyForm
          slug={slug}
          intro={data.messages.loyaltyIntro}
          cta={data.messages.loyaltyCta}
          placeholder={data.messages.loyaltyPlaceholder}
        />
      )}

      <p className="disclosure">{data.disclosure}</p>
      <p className="disclosure" style={{ marginTop: 8, opacity: 0.7 }}>
        {data.messages.poweredBy}
      </p>
    </main>
  );
}
