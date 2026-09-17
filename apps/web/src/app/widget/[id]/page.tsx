/**
 * Widget avis embarquable sur le site du commerçant.
 *
 * Destiné à un <iframe> : pas de navigation, pas de script, rendu serveur.
 * Il affiche une sélection d'avis 4-5★ déjà publiés et le renvoi vers la fiche
 * complète — la mention est explicite pour ne pas laisser croire que tous les
 * avis sont restitués ici (art. L.111-7-2 du code de la consommation).
 */

import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/api';
import { Stars, formatDate } from '@/components/ui';

interface WidgetPayload {
  establishment: { id: string; name: string };
  averageRating: number | null;
  totalCount: number;
  reviews: Array<{
    author: string;
    rating: number;
    comment: string;
    platform: string;
    publishedAt: string;
  }>;
  disclosure: string;
}

export const dynamic = 'force-dynamic';

export default async function WidgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await serverApi<WidgetPayload>(`/public/widget/${id}?limit=4`);
  if (!data) notFound();

  return (
    <div style={{ padding: 16, maxWidth: 680, margin: '0 auto' }}>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <strong style={{ fontSize: 16 }}>{data.establishment.name}</strong>
          <div className="row" style={{ gap: 8, marginTop: 2 }}>
            {data.averageRating != null && <Stars rating={data.averageRating} />}
            <span className="muted" style={{ fontSize: 13.5 }}>
              {data.averageRating != null && `${data.averageRating.toFixed(1)}/5 · `}
              {data.totalCount} avis
            </span>
          </div>
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        {data.reviews.map((review, index) => (
          <blockquote
            key={index}
            className="card"
            style={{ margin: 0, padding: 14 }}
          >
            <div className="row" style={{ gap: 8 }}>
              <Stars rating={review.rating} />
              <span style={{ fontSize: 13.5, fontWeight: 550 }}>{review.author}</span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {review.platform} · {formatDate(review.publishedAt)}
              </span>
            </div>
            <p style={{ fontSize: 14.5, margin: '8px 0 0', lineHeight: 1.5 }}>
              {review.comment}
            </p>
          </blockquote>
        ))}
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        {data.disclosure}
      </p>
    </div>
  );
}
