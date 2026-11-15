<div align="center">

<img src="docs/screenshots/hero-banner.svg" alt="Avisio NFC Platform Banner" width="100%" />

# Avisio NFC Platform

**Multi-location NFC review acceleration, smart deficit routing &amp; reputation intelligence platform**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.1-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.2-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-6.2-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Vitest](https://img.shields.io/badge/Vitest-399_Passed-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)

<p align="center">
  <a href="#screenshots">Screenshots</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#core-compliance-pledge">Compliance Pledge</a> •
  <a href="#how-to-install--configure">Installation</a> •
  <a href="#how-to-use">Usage Guide</a> •
  <a href="#testing--quality-assurance">Testing</a> •
  <a href="#background-automation-jobs">Background Jobs</a>
</p>

</div>

---

> **Core Principle: Avisio maximizes review volume; it never gates, filters, or censors customer feedback.**
> No intermediate step asks for a star rating before redirection, no incentive depends on the rating given, and no review is ever concealed or delayed. These strict compliance rules are implemented in `packages/core/src/compliance.ts` and enforced by automated tests.

---

## Screenshots

<table>
  <tr>
    <td width="50%" align="center">
      <strong>Showcase &amp; Value Proposition</strong><br/><br/>
      <img src="docs/screenshots/landing-hero.webp" alt="Avisio Showcase Hero" width="100%" />
    </td>
    <td width="50%" align="center">
      <strong>Interactive ROI &amp; Subscription Calculator</strong><br/><br/>
      <img src="docs/screenshots/landing-pricing.webp" alt="Avisio Interactive Quote Simulator" width="100%" />
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <strong>Commercial Onboarding &amp; Hardware Tag Encoder</strong><br/><br/>
      <img src="docs/screenshots/admin-onboarding.webp" alt="Avisio Commercial Onboarding" width="100%" />
    </td>
    <td width="50%" align="center">
      <strong>Enterprise Authentication Portal</strong><br/><br/>
      <img src="docs/screenshots/login.webp" alt="Avisio Login Portal" width="100%" />
    </td>
  </tr>
</table>

---

## Architecture

Avisio's monorepo architecture cleanly decouples edge customer touchpoints, compliance-enforced routing engines, and multi-tenant persistence layers:

```mermaid
flowchart LR
    subgraph Touchpoint ["1. Customer Touchpoint"]
        A1["NFC Physical Plaque (NTAG213 Encoded)"]
        A2["Dynamic Counter QR (Mobile Landing Page)"]
        A3["POS Webhook Invite (HMAC-SHA256 Signed)"]
    end

    subgraph CoreEngine ["2. Avisio Core Platform"]
        B["Anti-Gating Redirection Engine (packages/core - DGCCRF Compliant)"]
        C["Smart Deficit Router (Google, TripAdvisor, Facebook, TheFork)"]
        D["Multi-Tenant Data Layer (Prisma ORM / In-Memory Demo)"]
        E["AI Sentiment and Response Engine (Claude NLP / Brand Tone Analysis)"]
    end

    subgraph Management ["3. Management and Automation"]
        F["Next.js 15 Web Portal (Admin and Manager Dashboards)"]
        G["Fastify 5 API Server (REST and Webhooks - Port 4000)"]
        H["Real-Time Alert Dispatcher (Web Push and Resend Email)"]
    end

    A1 --> B
    A2 --> B
    A3 --> B
    B --> C
    C --> D
    D --> E
    D --> F
    D --> G
    E --> H
```

---

## Core Compliance Pledge

A customer taps their smartphone against an NFC plaque placed at the checkout counter, a lightweight mobile-optimized landing page opens instantly, and a single tap routes them to an online review platform.

On the business owner side: instant alerts on negative reviews, brand-tailored AI response drafts, balanced multi-platform routing, monthly performance digests, and automated sentiment intelligence on customer feedback. On the platform operator side: an administrative back-office managing multi-location fleets, subscription billing, and background automation jobs.

---

## How to Install & Configure

### Prerequisites
- **Node.js 20.11+** (Node 22 LTS recommended)
- **npm 10+**
- *(Optional)* **Docker & Docker Compose** (for running local PostgreSQL 16)

### Installation Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Emincanozen/avisio-nfc-platform.git
   cd avisio-nfc-platform
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build Core Packages:**
   ```bash
   npm run build -w @avisio/core
   ```

### Configuration & Environment Setup

All external environment variables are optional. When omitted, the platform gracefully runs in **zero-config demonstration mode** using an in-memory data store with seeded demo fixtures.

Copy `.env.example` to `.env` if customizing your setup:
```bash
cp .env.example .env
```

Key environment options:

| Variable | Default / Fallback | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | *In-memory store* | PostgreSQL connection string (e.g. `postgresql://avisio:avisio@localhost:5433/avisio`) |
| `PORT` | `4000` | Fastify backend API port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | API URL consumed by the Next.js web application |
| `ANTHROPIC_API_KEY` | *Local heuristic engine* | Claude API key for AI sentiment analysis & draft generation |
| `GOOGLE_CLIENT_ID` / `_SECRET` | *Unconnected* | Google Business Profile OAuth credentials |
| `RESEND_API_KEY` | *Console logger* | Transactional email delivery service |
| `VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` | *Console logger* | Web Push notification keys (generate with `npx web-push generate-vapid-keys`) |

### Running with a Real Database (PostgreSQL)

To use a persistent PostgreSQL 16 instance via Docker:
```bash
# 1. Start PostgreSQL 16 on port 5433
npm run db:up

# 2. Configure DATABASE_URL in .env
echo "DATABASE_URL=postgresql://avisio:avisio@localhost:5433/avisio" >> .env

# 3. Push Prisma schema & seed demo data
npm run db:push
npm run seed
```

---

## How to Use

### 1. Starting the Development Environment
Launch both the Fastify API (port 4000) and Next.js frontend (port 3000 or custom port):
```bash
npm run dev
```

To run only the web frontend on a custom port (e.g. `3209`):
```bash
cd apps/web
npx next dev -p 3209
```

### 2. Built-in Demonstration Accounts

| Account | Password | Scope & Role |
| :--- | :--- | :--- |
| `demo@avisio.fr` | `demo1234` | **Business Manager Portal** — access to 3 locations, real-time reviews, and notification settings |
| `admin@avisio.fr` | `admin1234` | **Platform Operator Back-Office** — fleet management, billing, MRR metrics, and automation jobs |

### 3. Application Routes

| URL Path | Purpose |
| :--- | :--- |
| `http://localhost:3000/` | Public showcase, features, and live quote simulator |
| `http://localhost:3000/login` | Authentication portal for managers and admins |
| `http://localhost:3000/admin` | Back-office: fleet overview, invoices, and job dispatchers |
| `http://localhost:3000/admin/nouveau` | Rapid client onboarding and NFC tag encoder wizard |
| `http://localhost:3000/s/k7m2p9qa` | Live NFC landing page (Restaurant tier) |
| `http://localhost:3000/s/z2q7v4kh` | Live NFC landing page (Hotel tier) |
| `http://localhost:3000/widget/est_comptoir` | Embeddable customer review rating badge |
| `http://localhost:4000/health` | API health check and active persistence mode |

### 4. Simulating POS Webhooks
Simulate a Point of Sale transaction triggering an automated review invite:
```bash
node scripts/pos-webhook-demo.mjs <api-key>
```
The script computes the required HMAC-SHA256 signature and tests anti-spam cooldown mechanisms.

---

## How to Create / Customize

### 1. Creating and Onboarding New Establishments
You can onboard new client establishments either visually or via the API:
- **Via the Web Interface:** Navigate to `http://localhost:3000/admin/nouveau`. Fill in the establishment name, business sector, brand voice tone, selected plan (`discovery`, `pro`, `performance`), and plaque count. The onboarding wizard computes the quote, creates the tenant, provisions manager credentials, and issues the opening invoice.
- **Via the API:** Send a `POST /admin/establishments` payload specifying business details, target review platforms, and tag allocations.

### 2. Customizing NFC Cards & Plaque Encoding
Avisio utilizes standard **NTAG213** NFC chips formatted with an NDEF URI record:
1. When an establishment is created, the system generates unique, tamper-resistant short slugs (e.g. `https://avisio.fr/s/k7m2p9qa`).
2. Encode the URL onto physical NFC chips using standard NFC encoding tools (e.g., NFC Tools mobile app or batch desktop writers).
3. Lock the chip in read-only mode prior to physical counter installation.
4. Each plaque URL automatically logs tap counts and client device languages without tracking personal customer identifiers.

### 3. Customizing Multi-Platform Smart Routing
Avisio dynamically distributes incoming review traffic across connected platforms (Google, TripAdvisor, Facebook, Yelp, TheFork) using a deficit-balancing routing algorithm:
- Configure platform weights and targets in the establishment settings (`dashboard/[id]/sources`).
- The routing engine (`packages/core/src/routing.ts`) calculates which platform has the greatest relative review deficit and routes the customer accordingly.
- Platforms can be enabled, paused, or prioritized per physical location.

### 4. Customizing Brand Voice & AI Reply Heuristics
When a negative review (1–3★) is ingested:
- The system checks the establishment's configured `brandTone` setting (e.g., *"chaleureux et direct, vouvoiement, jamais corporate"*).
- The reply engine (`packages/core/src/ai-reply.ts`) drafts a suggested response matching the brand tone, acknowledging specific issues mentioned (e.g., waiting time, food temperature) while avoiding legally risky admissions.
- The manager can approve, edit, or reject the suggestion in one click.

### 5. Customizing Loyalty Program Rules
- Loyalty points are granted strictly for *submitting* an evaluation—never contingent on the rating (compliance with French and international consumer review laws).
- Configure loyalty tiers and hash salts in `packages/core/src/loyalty.ts`. Customer phone numbers and emails are stored exclusively as one-way salted cryptographic hashes.

---

## Testing & Quality Assurance

Run the comprehensive test suite covering pricing algorithms, anti-gating compliance, multi-tenant isolation, dunning, and notification encryption:

```bash
# Run unit & integration test suite (399 tests across workspaces)
npm test

# Verify TypeScript type integrity
npm run typecheck

# Full production build verification
npm run build
```

Additional dedicated verification scripts:
```bash
# Push notification encryption & TLS pipeline verification
node scripts/push-selftest.mjs

# End-to-end HTTP smoke test (54 assertions)
node scripts/smoke-test.mjs

# Database schema & concurrent SQL operations (requires PostgreSQL)
npx tsx scripts/pg-verify.mts

# Secret & PII scanner across tracked files and git history
bash scripts/check-secrets.sh
```

---

## Background Automation Jobs

Background schedulers run automatically with the API and can also be triggered manually from the back-office:

| Job | Frequency | Description |
| :--- | :--- | :--- |
| **Review Ingestion** | Every 20 min | Polls connected review sources, runs NLP analysis, and dispatches alerts |
| **Trend Detection** | Every 24 h | Identifies recurring positive and negative customer feedback themes |
| **Billing & Dunning** | Every 6 h | Issues due invoices, executes dunning reminders, and suspends delinquent accounts |
| **Queued Push Flush** | Every 5 min | Flushes push notifications postponed by quiet hours |
| **Monthly Reports** | 1st of each month | Generates and delivers PDF executive review digests to eligible subscribers |

---

## License

Tous droits réservés © 2026 Avisio. Published for evaluation and demonstration purposes.
