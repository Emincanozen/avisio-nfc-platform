/** Formes de réponse de l'API, côté client. */

export interface LandingPayload {
  tag: { slug: string; label: string };
  establishment: { id: string; name: string };
  locale: string;
  messages: {
    title: string;
    subtitle: string;
    cta: string;
    redirecting: string;
    loyaltyIntro: string;
    loyaltyCta: string;
    loyaltyPlaceholder: string;
    loyaltySuccess: string;
    disclosure: string;
    disclosureWithReward: string;
    error: string;
    poweredBy: string;
  };
  platform: { id: string; label: string };
  loyaltyEnabled: boolean;
  disclosure: string;
}

export interface Establishment {
  id: string;
  name: string;
  sector: string;
  postalCode: string;
  plan: 'essentiel' | 'pro' | 'premium';
  addons: string[];
  brandTone: string;
  defaultLocale: string;
}

export interface EstablishmentDetail {
  establishment: Establishment;
  platformLinks: Array<{
    platform: string;
    reviewUrl: string;
    enabled: boolean;
    reviewCount: number;
    routedScans: number;
    averageRating?: number;
  }>;
  tags: Array<{ id: string; label: string; slug: string; scanCount: number; url: string }>;
  quota: number;
  features: Record<string, boolean>;
}

export interface Review {
  id: string;
  platform: string;
  author: string;
  rating: number;
  comment: string;
  publishedAt: string;
  status: 'new' | 'draft_ready' | 'answered' | 'ignored';
  replyText?: string;
  repliedAt?: string;
  analysis?: {
    sentiment: 'positive' | 'neutral' | 'negative';
    score: number;
    themes: string[];
    keywords: string[];
    engine: string;
  };
}

export interface Overview {
  establishmentId: string;
  windowDays: number;
  metrics: {
    total: number;
    averageRating: number;
    distribution: Record<string, number>;
    negativeCount: number;
    negativeReplyRate: number;
    replyRate: number;
    medianReplyDelayHours: number | null;
    overdueCount: number;
  };
  rating: { current: number; previous: number; delta: number };
  themes: Array<{
    theme: string;
    label: string;
    mentions: number;
    share: number;
    averageRating: number;
    sentiment: 'positive' | 'neutral' | 'negative';
  }>;
  platforms: Array<{
    platform: string;
    label: string;
    reviewCount: number;
    averageRating: number | null;
    routedScans: number;
    share: number;
  }>;
  trends: Array<{
    theme: string;
    label: string;
    shortWindowMentions: number;
    ratio: number;
    averageRating: number;
    severity: 'info' | 'warning' | 'critical';
    message: string;
  }>;
  scans: { total: number; byDay: Array<{ date: string; count: number }> };
  loyaltyMembers: number;
  scanToReviewRate: number | null;
}

export interface Alert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  reviewId?: string;
  createdAt: string;
  readAt?: string;
}

export interface Catalog {
  plans: Array<{
    id: string;
    name: string;
    monthlyCents: number;
    monthlyLabel: string;
    includedTags: number;
    extraPlatforms: number | null;
    features: string[];
    tagline: string;
  }>;
  addons: Array<{
    id: string;
    name: string;
    monthlyCents: number;
    monthlyLabel: string;
    perUnit: boolean;
  }>;
  oneOff: Record<string, { cents: number; label: string }>;
}

export interface Quote {
  lines: Array<{
    label: string;
    quantity: number;
    totalCents: number;
    totalLabel: string;
    kind: 'recurring' | 'one_off';
  }>;
  monthlyLabel: string;
  monthlyInclVatLabel: string;
  firstInvoiceLabel: string;
  redundantAddons: string[];
}
