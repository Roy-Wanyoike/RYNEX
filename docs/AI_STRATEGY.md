# RYNEX AI Strategy — The Intelligence Flywheel

> **One line:** RYNEX turns verified vehicle provenance into an AI asset nobody else in African
> mobility can copy — because every training example is labeled by a real, audited outcome.

| | |
|---|---|
| **Audience** | Investors (sections 1, 2, 5, 6) · Engineers (sections 3, 4, 6) |
| **Status** | Strategy of record · aligned to the product spec (AI Architecture, AI Safety Model, Fraud Intelligence, AI Scam Shield, Pricing Intelligence, AI Buying Agent, Recommendation Engine) |
| **Scope of this doc** | Why AI is the moat, what we build, what we buy, what we will never do, and what ships in *this repo* to feed it |
| **Owner** | AI Strategy Lead · Issue #5 |

---

## 1. Thesis: trust infrastructure is the ideal AI substrate

AI models are only as good as their data. In mobility, the data that matters — **what actually
happened to this vehicle, and what actually happened to this transaction** — is fragmented across
sellers' WhatsApp threads, handwritten service books, and memories. Nobody owns it. So everyone
building "AI for used cars" is training on listings: asking prices, photos, and marketing copy.
Listings are **claims**. Claims are the input to fraud, not the ground truth for intelligence.

RYNEX is building the only layer where those claims get resolved into outcomes:

- A vehicle's claims are verified and timestamped as **Passport events** (ownership, inspection,
  mileage, service, transfer).
- A transaction's outcome is recorded and **append-only audited** (escrow state machine, disputes,
  refunds) in the Data module.
- A seller's behavior is scored against **real dispute, complaint, and delivery history**, not
  self-declared ratings.

That produces the two properties no marketplace or classifieds player has:

1. **Proprietary provenance data.** A per-vehicle evidence graph (who owned it, who inspected it,
   what failed, what was repaired, what it sold for). Competitors can scrape listings; they cannot
   scrape verified outcomes that never touched their platform.
2. **Every event labeled by a real outcome.** A valuation model trained here learns from *closing
   prices + post-sale condition*, not asking prices. A fraud model learns from *confirmed scams and
   resolved disputes*, not heuristics alone. Inspection data is graded by human inspectors whose
   own accuracy is tracked. The labels are the moat.

**Why this makes RYNEX vital in the world of AI:** as buying decisions move to AI agents, agents
need a source of truth about physical assets they cannot inspect themselves. A buyer's agent that
quotes a RYNEX Passport ("87,231 km, odometer verified at inspection 4 months ago, 8 verified
events") is making a materially better decision than one summarizing a classifieds ad. RYNEX's
strategic position is to be **the evidence API that AI agents consult before any high-value
mobility transaction** — the way payment networks are consulted before any money moves.

The founder's directive is explicit: RYNEX must be vital in the world of AI. This document
translates that into a concrete capability portfolio, safety model, and roadmap.

---

## 2. The data flywheel

The spec's trust flywheel (§72) is an AI flywheel in disguise. Each turn compounds three assets:
the **provenance graph**, the **outcome labels**, and the **models** they train.

```
                 ┌──────────────────────────────────────────────────────────┐
                 │                    RYNEX PLATFORM                        │
                 │                                                          │
   vehicles ────▶│  Passport events ──┐                                     │
   sellers  ────▶│  (identity, owner, │                                     │
   garages  ────▶│   inspection,      │                                     │
   parts    ────▶│   mileage, service,│                                     │
                 │   transfer)        │                                     │
                 │                    ▼                                     │
                 │        ┌───────────────────────┐                         │
                 │        │   PROVENANCE GRAPH    │                         │
                 │        │  vehicle ↔ seller ↔   │                         │
                 │        │  phone ↔ device ↔     │                         │
                 │        │  payment ↔ complaint  │                         │
                 │        └───────────┬───────────┘                         │
                 │                    │  features + labels                  │
                 │                    ▼                                     │
                 │  transactions ──▶ MODELS (valuation · fraud · scam risk  │
                 │  inspections    │          · recommendation · forecast)  │
                 │  service hist.  │                                        │
                 │  disputes ──────┘                                        │
                 │                    │                                     │
                 │                    ▼                                     │
                 │        Better scores, better ranks, better warnings      │
                 │                    │                                     │
   audit log ◀───┴──── every AI decision logged (model, version, evidence)  │
                 └────────────────────────┬─────────────────────────────────┘
                                          │
                                          ▼
                              Buyers & agents trust RYNEX
                                          │
                                          ▼
                          More transactions on-platform (not WhatsApp)
                                          │
                                          ▼
                    More outcomes labeled → feed back to PROVENANCE GRAPH
```

**Why the loop is defensible (and why it accelerates):**

| Stage | Compounding effect | Why competitors can't shortcut it |
|---|---|---|
| More transactions | Every escrow close produces a **price + condition + seller** triple | Transactions only happen where buyers trust — and trust is the product |
| More inspections & service records | Physical ground truth for condition and mileage | Requires the inspector and garage network RYNEX is signing |
| More disputes, resolved | The **negative labels** fraud models desperately need | Disputes are embarrassing; off-platform players never see them |
| Provenance graph grows | New vehicles inherit signal from linked phones, images, payment accounts | Graph effects are superlinear — a duplicate image means nothing alone, everything at 8 listings |
| Models improve | Valuation, fraud, scam, recommendation all sharpen | Labels from resolved outcomes can't be synthesized |

The audit log (Data module) is the flywheel's flywheel: because every AI output and every platform
event is append-only recorded, the training set is **reproducible and litigable** — a regulator, a
court, or an enterprise customer can replay any decision. That is what makes the data enterprise-
and API-sellable, not just internally useful.

---

## 3. AI capability portfolio

Launch phases: **P0** — this sprint, in this repo · **P1** — next 90 days · **P2** — year 1 ·
**P3** — years 2–3. "Data: have" = captured by code already in this repo; "Data: add" = new
capture we must build. Model approach deliberately escalates *classical first, LLM where it earns
its cost* — every capability ships a deterministic v0 before any learned v1.

### 3.1 Portfolio at a glance

| # | Capability | Phase | Model class (v0 → vN) | Ships revenue/retention via |
|---|---|---|---|---|
| 1 | Vehicle valuation | P0 → P2 | Heuristic rules → gradient boosting | Intelligence API, dealer SaaS pricing agent |
| 2 | Fraud & anomaly detection | P1 → P2 | Rules + outlier stats → supervised boosting + graph | Trust scores, dispute reduction, protected transactions |
| 3 | Scam shield | P1 → P2 | Rule risk cards → conversation/listing risk classifier | Buyer protection, premium consumer tier |
| 4 | AI buying assistant | P2 → P3 | Retrieval + constrained LLM agent | Premium consumer, agent API (Phase 6) |
| 5 | Inspector copilot | P2 → P3 | Photo CV triage + OCR, human-in-command | Inspection throughput & consistency |
| 6 | Service & parts demand forecasting | P2 → P3 | Seasonal baselines → gradient boosting | Garage SaaS retention, parts marketplace liquidity |
| 7 | Trust score explanations | P1 | Component scores + reason codes (SHAP-style) | Trust product credibility, API tier |

### 3.2 Capability detail

#### 1 · Vehicle valuation

- **User story.** *As a private seller, I ask "what's my 2019 Toyota Harrier worth?" and get a
  range with the evidence behind it, so I price to sell without giving the margin away.* *(As a
  dealer, I get suggested list prices per unit against live market positioning.)*
- **Model approach.** v0 (P0, **landing this sprint** in the Intelligence module): transparent
  heuristic valuation — brand/model/bodyType base rates from market stats, with declared
  adjustments. v1 (P1–P2): gradient boosting (LightGBM-class) on provenance features: year,
  mileage, trim, location, import history, inspection condition grade, days-on-market, and
  **closing-price labels from the Finance module**. Quantile models output the spec's
  Low / Typical / High band; assessment surfaced as *Fair / High / Low / Insufficient data*.
- **Data required.** Have (this repo): `Cars.brand, model, bodyType, prices, pictureUrl` listing
  rows; Intelligence market-stat baselines (landing this sprint). Add: year/mileage/trim columns on
  listings, inspection condition grades, transaction closing prices + days-to-close (Finance),
  odometer-verified readings (Passport).
- **Never:** present an estimate as a guaranteed market value (spec §27).
- **Guardrail:** below a support threshold of comparable labeled sales, the API returns
  `INSUFFICIENT_DATA` instead of a number. A confident wrong price destroys more trust than no
  price.

#### 2 · Fraud & anomaly detection

- **User story.** *As a platform operator, I see each listing risk-scored with human-readable
  reasons — "duplicate images across 8 listings and 5 seller accounts; price 34% below comparable;
  seller verification incomplete" — so I review the right things first.* *(As a buyer, I never
  meet the HIGH-risk listing at all.)*
- **Model approach.** v0 (P1): deterministic rules and statistics — price outlier z-scores against
  Intelligence baselines, duplicate-image clustering (perceptual hashes + embeddings, spec §26),
  odometer-jump detection over Passport event timelines, listing-behavior velocity rules. v1 (P2):
  supervised gradient boosting / isolation-forest ensemble scored on resolved dispute and
  inspection-failure outcomes; v2 (P3): fraud intelligence **graph** queries (spec §64) —
  seller → phone → device → payment destination → complaint — for cross-account pattern detection.
  Output: `LOW / MEDIUM / HIGH / CRITICAL` with **reason codes**, per spec §24.
- **Data required.** Have: listing rows + images, user accounts (`users.userName, email, phoneNo`),
  Passport event timeline, append-only audit log. Add: device/IP/session signals, payment
  destinations (Finance), dispute records with resolutions, duplicate-image index.
- **Never:** accuse a user of a crime because a model said so (spec §14/§24). Risk output routes to
  *investigation → evidence → decision → appeal*, with humans making adverse calls.

#### 3 · AI Scam Shield

- **User story.** *As a buyer about to send a deposit, I paste the listing link or screenshot the
  WhatsApp conversation and get: "Risk: HIGH — (1) seller not verified, (2) images match another
  vehicle, (3) price far below comparable listings, (4) payment requested before inspection.
  Recommendation: do not pay directly."*
- **Model approach.** v0 (P1): rules over submittable artifacts — price anomaly check vs
  valuation, duplicate-image lookup, urgency/payment-pattern keyword rules. v1 (P2): a
  conversation/listing risk classifier (gradient boosting over extracted features; LLM used
  **read-only** to structure free-text conversations into features — payment requests, urgency,
  identity mismatch — never to render the verdict). Every response separates **evidence · signal ·
  inference · recommendation** (spec §25).
- **Data required.** Have: listings + images, Passport events. Add: user-submitted reports
  (listing URL, screenshot, conversation), a labeled scam corpus from confirmed cases + triaged
  false positives.
- **Product principle (spec §65):** the shield also *warns at exit* — when a user tries to move a
  transaction off-platform, the platform says so before they lose protection.

#### 4 · AI buying assistant

- **User story.** *As a first-time buyer I say "I need a reliable SUV under KSh 3.5M that won't be
  expensive to maintain" and get 3 recommendations and an honest exclusion list: "17 vehicles
  matched; I excluded 9 for incomplete history, 3 for suspicious pricing, 2 with no inspectable
  seller."*
- **Model approach.** Retrieval-grounded agent, not a chatbot with opinions: LLM orchestrates
  **tool calls into our own versioned APIs** (`/api/v1/intelligence`, `/api/v1/passport`,
  `/api/v1/trust`, search) — retrieval over real inventory, ranking via the Recommendation Engine,
  TCO estimation from service/parts data. Every factual sentence must link to evidence (a Passport
  event, an inspection line, a market-stat row). **Explain recommendations *and* exclusions**
  (spec §28/§30).
- **Data required.** Have: inventory + Passport + Trust + Intelligence endpoints (all mounted
  under `/api/v1` in this repo's gateway). Add: TCO model inputs (service records, parts prices),
  the Recommendation Engine ranker (§7 below feeds it), conversation UX.
- **Never:** invent vehicle facts (spec §60). Where evidence is missing the assistant says
  *Unknown / Not verified / Needs inspection* — the same vocabulary as the Passport.

#### 5 · Inspector copilot

- **User story.** *As a field inspector, my app pre-screens each photo — "blurry, retake";
  "possible repaint, panel 3 — confirm"; "VIN OCR: confirm against chassis" — so reports are
  complete, consistent, and fast, and mileage inconsistencies get caught before they become a
  Passport lie.*
- **Model approach.** v0 (P2): image-quality checks, perceptual-hash duplicate detection, VIN and
  document OCR, dashboard-warning-light detection — all deterministic CV/OCR, no ML training
  required. v1 (P3): damage/condition triage model fine-tuned on **our** inspection photos, graded
  against inspector adjudication (which itself becomes a label — inspector agreement rates feed
  Trust). The human inspector is authoritative; AI output always carries **confidence,
  model/version, timestamp, evidence** (spec §23).
- **Data required.** Have: listing images (`Cars.pictureUrl`). Add: the inspection capture flow
  (photo set, checklist, GPS, timestamps) from the offline inspector app.
- **Hard rule:** AI assists; only humans declare a vehicle inspected.

#### 6 · Service & parts demand forecasting

- **User story.** *As a garage owner I see "expect ~14 bookings next month; brake-pad jobs up
  ahead of the rainy season for models X/Y" and pre-order parts and staff accordingly.* *(As a
  parts seller, I stock what the parc will actually need.)*
- **Model approach.** v0 (P2): seasonal-naive and moving-average baselines per garage/model/part —
  cheap, explainable, already better than intuition. v1 (P3): gradient-boosted time-series with
  vehicle-parc covariates (model mix in the region, vehicle ages from Passports, seasonality).
- **Data required.** Have: Parts catalogue with vehicle compatibility, Service bookings schema
  (modules mounted in this repo). Add: booking volume history, parts sale history, garage
  completion rates.
- **Why it matters strategically:** forecasting is the retention engine of Garage SaaS and Parts
  — it converts RYNEX data into *money saved every month*, the stickiest kind of value.

#### 7 · Trust score explanations (reason codes)

- **User story.** *As a seller whose trust score dropped, I see exactly which components moved and
  why — so I can fix it, and so I can't claim the system is rigged.* *(As a buyer's AI agent, I
  consume machine-readable reason codes to explain a recommendation.)*
- **Model approach.** The Trust score is deliberately a **component architecture** (spec §45:
  identity, ownership, inspection, history, mileage, seller, price confidence) — the overall score
  is derived, never hand-set, and **cannot be purchased**. v0 (P1): each component emits plain-
  language reason codes; the display shows the component breakdown. v1 (P2): where components use
  learned models, SHAP-style attributions are generated per score and stored with the audit entry,
  so *any historical score can be re-explained*.
- **Data required.** Have: Passport events, audit log, Trust module extension (landing this
  sprint). Add: component-level model outputs logged via the AI gateway (§4 of safety model).

---

## 4. AI safety & ethics — the safety model is the product

In a trust company, an unsafe AI is not a compliance issue; it is a **balance-sheet event**. These
rules bind every capability above and every future one. They implement the spec's AI Safety Model
(§14), AI Guardrails (§60), Fraud & Risk (§24), and Trust Score (§45) requirements.

### 4.1 The epistemic contract — six labels, no upgrades

Every AI-produced statement carries exactly one label:

```
VERIFIED FACT · DECLARED CLAIM · THIRD-PARTY REPORT
AI INFERENCE · UNKNOWN · DISPUTED
```

- **AI inference is never converted to verified fact** — not in the Passport, not in a trust
  score, not in an agent's answer. Promotion requires human verification or documentary evidence,
  and the promotion itself is an audited event.
- Where evidence is insufficient, systems say `UNKNOWN`, `NOT VERIFIED`, `NEEDS INSPECTION`, or
  `POTENTIAL ANOMALY`. A useful "I don't know" is a feature; a confident fabrication is the
  fastest way to kill a trust company.

### 4.2 Explainability requirement

- No risk score, trust score, price assessment, or exclusion decision ships without a
  human-readable reason. `HIGH RISK` always arrives with *Reasons:* (spec §24's own format).
- Every AI request/response is logged through the **AI gateway**: model, version,
  prompt/template version, input references, output, confidence, timestamp (spec §59) — stored
  append-only in the Data module. Historical decisions remain re-explainable.

### 4.3 Human-in-the-loop for adverse decisions

- **No opaque automated denials.** Automated risk outputs may *down-rank, warn, or hold for
  review*; they may never by themselves ban an account, void a sale, or publish an accusation.
  Adverse actions = human decision + evidence + written reason + **right of appeal** (spec §14:
  risk signal → investigation → evidence → decision → appeal).
- Inspectors outrank the copilot; support agents outrank the scam classifier; the buying assistant
  never completes a transaction unattended.

### 4.4 Bias review

- Quarterly review of model error rates **sliced by region, seller type (private vs dealer vs
  garage), vehicle price band, and gender where lawfully collected** — hunting for systematic
  under-valuation of certain regions or over-flagging of certain seller classes.
- Remediation rule: if a protected slice shows materially worse false-positive rates in fraud
  systems, the threshold is loosened for review (never silently tightened) and the change is
  audit-logged.
- Trust components are designed so **no seller can buy a higher score** (spec §45) — paid
  placement never silently overrides trust ranking (spec §61); sponsored inventory is labeled.

### 4.5 Data privacy — Kenya DPA 2019

- **Lawful basis & minimization:** provenance events carry vehicle facts, not person-facts, where
  possible; identity data is collected on documented lawful bases and retained per a published
  schedule.
- **Purpose limitation:** platform data trains platform models on **aggregated, de-identified
  features**; raw personal data is not shipped to third-party AI providers (spec §59: do not store
  unnecessary sensitive data in AI providers). LLM calls send evidence snippets under
  data-handling agreements, never identity documents.
- **Rights:** access, correction, and deletion workflows; the append-only audit log stores
  *hashes/references and tombstones for erasures* — immutability applies to event history, not to
  the unlawful persistence of personal data.
- **Fraud graph containment (spec §64):** relationship intelligence is used internally for risk
  and never exposes sensitive graph data publicly or to other sellers.
- **DPO function, DPIAs** before each new AI capability processing personal data, and
  registrar registration as we cross the processing thresholds.

### 4.6 Guardrails (verbatim commitments)

RYNEX AI systems will never: invent vehicle history or ownership · accuse users of crimes ·
guarantee vehicle safety · guarantee a price · claim government verification that did not occur ·
fabricate inspection results · encourage direct deposit, WhatsApp-only deals, or off-platform
payment (spec §65).

---

## 5. Build vs buy

Principle: **buy commodities, build only where provenance data is the differentiator.** We do not
train foundation models; we make our evidence graph the thing foundation-model-based agents want.

| Layer | Build | Buy / consume | Rationale |
|---|---|---|---|
| LLM reasoning & conversation | Prompt/engineering layer, eval harness, tool contracts | Frontier LLM APIs (multi-provider via AI gateway) | Commodity, fast-moving; our value is the evidence we feed it |
| OCR & document parsing | Verification logic on top | OCR / document-analysis APIs | Commodity |
| Image embedding & pHash | Duplicate-image index & graph (ours) | Embedding models / reverse-image where lawful (spec §26) | The index across *our* listings is the asset |
| Valuation, fraud, forecasting, recommendation | **Train in-house** on RYNEX outcome labels | — | This is the moat; nobody else has the labels |
| Trust explanations | In-house reason-code & attribution layer | SHAP/open-source libraries | Thin, differentiating |
| Vector search & feature store | Thin wrappers | Managed vector DB / feature store | Operational leverage, not differentiation |
| MLOps | Evaluation, drift monitors, AI-gateway logging | Managed serving/monitoring | Small team; buy plumbing |

**AI gateway (spec §59):** all capabilities — regardless of provider — go through one internal
gateway that enforces logging (model/version/confidence/timestamp), provider fallback, data-
minimization filters, and cost budgets. No product code couples to a single AI vendor.

**Cost envelope (order of magnitude, monthly):**

| Phase | Spend | Composition |
|---|---|---|
| P0 — this sprint | **< $500** | Heuristic valuation + market stats run on the existing MSSQL/API stack; zero inference spend |
| P1 — 90 days | **$0.5–2k** | Rules-based fraud/scam; pHash + embeddings at listing volume; 1 GPU-less training pipeline (CPU LightGBM); LLM only for internal tooling |
| P2 — year 1 | **$2–8k** | Buying-assistant LLM calls (metered, cached, capped per conversation); vector search; supervised model training runs; human review tooling |
| P3 — years 2–3 | **$10–40k** | Fine-tuned CV copilot; graph risk infrastructure; dealer/garage AI agents; scaled inference across the network |

Unit economics note: every P2+ capability is metered against the revenue line it serves
(Vehicle Data API calls, Dealer SaaS pricing agent, Garage SaaS forecasts, premium consumer AI) —
AI cost of revenue is a budgeted % of the take it enables, reviewed monthly against spec §71
metrics.

---

## 6. Roadmap and what this repo ships to feed it

### 6.1 90 days (P1)

| Deliverable | Feeding work in THIS repo | Success metric |
|---|---|---|
| Intelligence baselines live: market stats per brand/model + heuristic valuation API | Intelligence module + `/api/v1/intelligence` mount (this sprint) | Valuation endpoint serves ranges for top-20 brands; `INSUFFICIENT_DATA` rate tracked |
| Trust score v0 with component breakdown + reason codes | Trust module extension (this sprint) + audit log writes | 100% of scores render reason codes; zero unexplained score changes |
| Duplicate-image index v0 (pHash) over listing images | `Cars.pictureUrl` corpus + Passport events | ≥ 90% of known-seeded duplicate sets caught; false-positive rate < 5% |
| Price-outlier & odometer-jump rules | Passport event timeline + Intelligence stats | Rules fire on injected test fraud with < 10% FP on live listings |
| AI request logging via gateway pattern | Data module append-only audit log | Every AI/rule decision row has model, version, inputs ref, confidence, timestamp |
| Label factory begins | Dispute/resolution and escrow outcomes captured as first-class events | First 100 labeled outcome triples (price+condition+seller) banked |

### 6.2 Year 1 (P2)

| Deliverable | Success metric |
|---|---|
| Gradient-boosted valuation on closing prices (quantile Low/Typical/High) | MAPE beats heuristic baseline by ≥ 25% on held-out closing prices; adopted by ≥ 50 dealer listings/week |
| Supervised fraud scoring + scam shield v1 (user-submitted reports) | Confirmed-scam rate on transacted vehicles down ≥ 40% vs baseline; scam reports triaged < 24h; appeal overturn rate < 15% |
| Recommendation engine v1 (trust-first ranking, labeled sponsored) | Recommendation CTR-to-inspection ≥ baseline + 30%; zero unlabeled sponsored overrides |
| AI buying assistant beta (tool-calling, evidence-linked) | ≥ 60% of beta sessions end in inspection booking; hallucination evals: 0 fabricated facts on gold set |
| Inspector copilot v0 (quality checks, VIN/doc OCR, warning lights) | Inspection report completion time −25%; field-error rate −30% |
| Seasonal forecasting baselines for garages | ≥ 30% of active garages act on forecasts monthly (feature retention) |
| Quarterly bias review + DPIAs institutionalized | 4/4 reviews completed with published remediation actions |

### 6.3 Year 3 (P3)

| Deliverable | Success metric |
|---|---|
| Fraud intelligence graph across sellers/phones/devices/payments/complaints | Cross-account fraud rings detected before first victim transaction (measured on red-team drills) |
| Inspector copilot v1 (damage/repaint/tyre triage, human-commanded) | Copilot/inspector agreement ≥ 90% on triage; inspector network throughput ×2 |
| Agentic buyer + dealer AI suite (inventory/pricing/sales/fraud/analytics agents, spec §53) | Dealer SaaS ARPU uplift ≥ 30% attributable to AI agents; analytics agent answers ≥ 80% of business questions correctly |
| **Vehicle Data API + agent API as revenue lines** (spec Phase 6) | ≥ 10 enterprise/partner integrations consuming Passports, risk, and valuation; AI-attributable revenue ≥ 20% of platform revenue |
| Provenance graph as agent infrastructure | RYNEX cited as evidence source by ≥ 3 third-party buying agents (the "vital in the world of AI" end-state) |

### 6.4 What this repo already ships (or lands this sprint) to feed the flywheel

| Repo asset | AI role |
|---|---|
| Marketplace core (`users`, `Cars`, `cart`, `specCarOrders` + stored procedures) | Listing corpus, seller accounts, demand signals — v0 features for valuation & recommendation |
| Passport module — vehicle event timeline | Provenance graph backbone; odometer-jump & history-completeness features |
| Data module — append-only audit log | Reproducible training set; AI-gateway decision log; litigation-grade evidence |
| Intelligence module — market stats + heuristic valuation | Valuation v0 and the baseline the models must beat |
| Trust module | Component trust scores → reason-code explainability (capability #7) |
| Finance module (escrow state machine) | Closing-price labels and transaction-safety features |
| Parts + Service modules | Forecasting inputs; TCO features for the buying assistant |
| `/api/v1` gateway in `services/vehicles-api` | The tool surface the AI buying assistant and external agents call — AI never bypasses the versioned API |

**Bottom line:** we are not bolting AI onto a marketplace. We are building the evidence layer that
makes AI about vehicles *possible* — first for our own models, then for our customers' AI, then
for the internet's AI. Every sprint that adds verified events is a sprint that compounds.

---

*Aligned to the RYNEX product spec: AI Architecture (§59), AI Guardrails (§60), AI Safety Model
(§14), AI Vehicle Inspection (§23), Fraud & Risk Engine (§24), AI Scam Shield (§25), Duplicate
Image Detection (§26), Price Intelligence (§27), AI Buying Assistant (§28), Recommendation Engine
(§31/§61), Fraud Intelligence Graph (§64), Anti-Scam Design Principles (§65), Trust Flywheel
(§72). Country of first operation: Kenya (DPA 2019 compliance modeled here).*
