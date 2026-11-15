'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, clearToken } from '@/lib/api';
import type { EstablishmentDetail, Review } from '@/lib/types';
import { Empty, Stars, relativeDays } from '@/components/ui';

type Filter = 'negatifs' | 'a_traiter' | 'tous';

const FILTERS: Array<{ id: Filter; label: string; query: string }> = [
  { id: 'negatifs', label: 'Avis négatifs', query: 'maxRating=3&limit=50' },
  { id: 'a_traiter', label: 'Sans réponse', query: 'status=new&limit=50' },
  { id: 'tous', label: 'Tous', query: 'limit=50' },
];

export default function ReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [filter, setFilter] = useState<Filter>('negatifs');
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [detail, setDetail] = useState<EstablishmentDetail | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const query = FILTERS.find((f) => f.id === filter)!.query;
    try {
      const [list, detailData] = await Promise.all([
        api<Review[]>(`/establishments/${id}/reviews?${query}`),
        api<EstablishmentDetail>(`/establishments/${id}`),
      ]);
      setReviews(list);
      setDetail(detailData);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    }
  }, [filter, id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Empty>{error}</Empty>;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`btn ${filter === item.id ? 'btn-dark' : 'btn-ghost'}`}
            style={{ padding: '8px 14px', fontSize: 14 }}
            onClick={() => {
              setReviews(null);
              setFilter(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!reviews && <Empty>Chargement…</Empty>}
      {reviews?.length === 0 && <Empty>Aucun avis dans cette sélection.</Empty>}

      {reviews?.map((review) => (
        <ReviewCard
          key={review.id}
          review={review}
          aiEnabled={detail?.features.aiReplies ?? false}
          onChanged={() => void load()}
        />
      ))}
    </div>
  );
}

function ReviewCard({
  review,
  aiEnabled,
  onChanged,
}: {
  review: Review;
  aiEnabled: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(review.replyText ?? '');
  const [gesture, setGesture] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<'' | 'suggest' | 'publish'>('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);

  const suggest = async (): Promise<void> => {
    setBusy('suggest');
    setMessage('');
    try {
      const result = await api<{ text: string; warnings: string[]; engine: string }>(
        `/reviews/${review.id}/suggest-reply`,
        { method: 'POST', body: JSON.stringify(gesture ? { gesture } : {}) },
      );
      setDraft(result.text);
      setWarnings(result.warnings);
      if (result.engine === 'template') {
        setMessage('Réponse produite par le modèle de secours (clé API Claude absente).');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Suggestion impossible.');
    } finally {
      setBusy('');
    }
  };

  const publish = async (): Promise<void> => {
    setBusy('publish');
    setMessage('');
    try {
      const result = await api<{ warnings: string[]; published: boolean }>(
        `/reviews/${review.id}/reply`,
        { method: 'POST', body: JSON.stringify({ text: draft }) },
      );
      setWarnings(result.warnings);
      setMessage(
        result.published
          ? 'Réponse publiée sur la plateforme.'
          : 'Réponse enregistrée. La publication réelle nécessite la connexion à l’API de la plateforme.',
      );
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Publication impossible.');
    } finally {
      setBusy('');
    }
  };

  const tone =
    review.rating <= 2 ? 'badge-critical' : review.rating === 3 ? 'badge-warning' : 'badge-positive';

  return (
    <article className="review">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <Stars rating={review.rating} />
            <strong style={{ fontSize: 14.5 }}>{review.author}</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              {review.platform} · {relativeDays(review.publishedAt)}
            </span>
          </div>
        </div>
        <span className={`badge ${review.status === 'answered' ? 'badge-positive' : tone}`}>
          {review.status === 'answered' ? 'Répondu' : review.status === 'ignored' ? 'Ignoré' : 'À traiter'}
        </span>
      </div>

      <p style={{ fontSize: 15, margin: '10px 0 8px', lineHeight: 1.55 }}>{review.comment}</p>

      {review.analysis && (
        <div className="row" style={{ gap: 6 }}>
          {review.analysis.themes.map((theme) => (
            <span key={theme} className="badge badge-neutral">
              {theme}
            </span>
          ))}
        </div>
      )}

      {review.status === 'answered' && review.replyText && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: 'var(--surface-2)',
            borderRadius: 10,
            fontSize: 14,
          }}
        >
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>
            Votre réponse
          </div>
          {review.replyText}
        </div>
      )}

      {review.status !== 'answered' && (
        <div style={{ marginTop: 12 }}>
          {!open ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '8px 14px', fontSize: 14 }}
              onClick={() => setOpen(true)}
            >
              Répondre
            </button>
          ) : (
            <div className="stack">
              {aiEnabled && (
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 180 }}
                    placeholder="Geste commercial autorisé (facultatif)"
                    value={gesture}
                    onChange={(event) => setGesture(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '10px 14px', fontSize: 14 }}
                    onClick={() => void suggest()}
                    disabled={busy !== ''}
                  >
                    {busy === 'suggest' ? 'Rédaction…' : 'Proposer une réponse'}
                  </button>
                </div>
              )}

              <textarea
                className="input"
                value={draft}
                placeholder="Votre réponse publique…"
                onChange={(event) => setDraft(event.target.value)}
              />

              {warnings.map((warning) => (
                <p
                  key={warning}
                  style={{
                    fontSize: 13.5,
                    color: 'var(--warning)',
                    background: 'var(--warning-soft)',
                    padding: '8px 10px',
                    borderRadius: 8,
                    margin: 0,
                  }}
                >
                  {warning}
                </p>
              ))}

              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '10px 16px', fontSize: 14 }}
                  onClick={() => void publish()}
                  disabled={busy !== '' || draft.trim().length < 10}
                >
                  {busy === 'publish' ? 'Publication…' : 'Publier la réponse'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '10px 16px', fontSize: 14 }}
                  onClick={() => setOpen(false)}
                >
                  Annuler
                </button>
              </div>

              {message && (
                <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
                  {message}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
