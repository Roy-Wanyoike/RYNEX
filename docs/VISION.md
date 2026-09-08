# RYNEX — Product Vision

> **The trust and intelligence infrastructure for mobility.**
> RYNEX connects vehicles, people, businesses and transactions — starting with a verified
> vehicle marketplace for Kenya, growing into the trust layer every automotive
> transaction in Africa runs on.

**Core principle:** *Don't ask buyers to trust the seller. Give buyers evidence.*

---

## Mission

Africa's used-vehicle trade runs on word of mouth and hope: buyers hand over life savings
for assets they cannot verify, and honest sellers cannot prove they are honest. RYNEX exists
to fix that. We build the identity, provenance, trust and transaction rails that let any
vehicle carry verifiable evidence of what it is, what happened to it, and who is selling it —
so that every automotive decision in the market can be made on proof instead of promises.
The marketplace is how buyers and sellers find us; the trust infrastructure underneath it is
what they cannot leave.

## The problem

Kenya is one of the world's largest markets for used Japanese imports, and almost none of the
value in that market is verifiable online today. The CarTrust Kenya engineering brief — the
product source of truth this vision is built from — is explicit about what buyers face:

- **Odometer fraud.** Mileage is routinely rolled back before sale. The brief's canonical
  example is a vehicle showing 92,000 → 108,000 → 126,000 km across three years, then 71,000
  km in year four — an anomaly no classifieds platform even looks for ([spec](../README.md),
  "Mileage Integrity").
- **Stolen and re-identified vehicles.** Registration numbers, chassis and engine numbers can
  be swapped; there is no consumer-accessible way to bind a listing to a physical vehicle's
  identity with a confidence score.
- **Fake and recycled listings.** The same photos appear across "8 listings, 5 seller
  accounts, 3 locations" — the brief's duplicate-image scenario — while escrow-free "direct
  deposit" and WhatsApp-only payment requests drain buyers' accounts with no recourse.
- **No provenance.** Import record, ownership chain, inspection history, service records —
  the evidence that actually determines a vehicle's value — live in filing cabinets, not
  databases. Every claim is seller-declared, and nothing is auditable.

The brief is equally clear about what the solution is *not*: "Do NOT build a clone of Jiji,
Cheki, AutoTrader, or another classifieds platform." Classifieds monetize listing volume.
Volume without verification is precisely the problem.

## The thesis

**Trust infrastructure beats classifieds — and eventually subsumes them.**

A classifieds site is a bulletin board: photos, price, seller, phone number. Its moat is
traffic, which anyone with an ad budget can rent. RYNEX's moat is compounding and exclusive:

```
Identity  →  every vehicle gets a durable digital identity (VIN/chassis/engine/reg, confidence-scored)
Provenance →  every meaningful event (import, inspection, service, transfer, sale) becomes an
              append-only, evidence-backed record
Trust     →  identities + provenance + verified transactions + reviews compile into explainable
             trust scores for vehicles and sellers
Intelligence → the resulting dataset powers pricing, fraud detection, recommendations and APIs
              that a classifieds site with no ground truth cannot replicate
```

Each layer feeds the next: more vehicles mean more history, more history means better fraud
detection and pricing, better trust means more transactions, and more transactions generate
more evidence. That flywheel is the business. The marketplace is the front door because it is
where the market already is — but the durable assets are the passport data, the provenance
graph and the trust engine behind it.

## The product network

| Product | What it does | Status |
|---|---|---|
| **Rynex Vehicles** | Verified vehicle marketplace — the front door: discovery, listings, cart, buyer/seller flows | 🟢 Live in this repo |
| **Rynex Passport** | Digital identity + provenance timeline per vehicle: who it is, what happened to it, with evidence | 🔵 Module shipped |
| **Rynex Trust** | Seller verification, reputation and explainable trust scores — never purchasable, never ad-influenced | 🔵 Module shipped |
| **Rynex Intelligence** | Market stats, price ranges, valuation heuristics — estimates always labeled, never guarantees | 🔵 Module shipped |
| **Rynex Parts** | Parts catalogue with vehicle compatibility, building the parts-provenance layer | 🔵 Module shipped |
| **Rynex Service** | Service bookings and maintenance records that append verified events to vehicle history | 🔵 Module shipped |
| **Rynex Fleet** | Multi-vehicle management foundations for fleet operators, rentals and corporate fleets | 🔵 Module shipped |
| **Rynex Finance** | Protected transactions, escrow state machine, M-Pesa-ready payment abstraction | 🔵 Module shipped |
| **Rynex API** | Versioned public gateway (`/api/v1`) — the same rails we use, opened to banks, insurers, dealers | 🔵 Module shipped |
| **Rynex Data** | Append-only audit trail and event foundation — every claim auditable, every state transition logged | 🔵 Module shipped |

Current build status and architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Sequenced delivery:
[ROADMAP.md](ROADMAP.md). Shipped-vs-pending detail: [FEATURES.md](FEATURES.md).

## Operating principles

1. **Proof before price.** A listing is not ready to sell until identity, ownership evidence,
   inspection and history are in place. Traditional marketplaces show price first; we show
   evidence first, because price without evidence is how people get robbed.
2. **Evidence, not trust.** We never ask buyers to take a seller's — or our own — word for
   anything. VERIFIED, SELLER_DECLARED, THIRD_PARTY_REPORTED, INFERRED, UNKNOWN and DISPUTED
   are distinct states, and we never launder one into another.
3. **Every claim auditable.** Every important state transition produces an audit event: who,
   what, when, where, before, after. Provenance is append-only; corrections create new events
   and never silently rewrite history.
4. **AI that explains.** AI ranks, flags and summarizes — it never becomes the source of truth
   for identity, ownership, payment or legal status. Every AI output carries confidence, model
   version and evidence, says "unknown" when evidence is insufficient, and flags anomalies
   ("ANOMALY DETECTED") without accusing anyone of crimes.
5. **No fake verification.** We never display "NTSA Verified" unless verification actually
   happened through an authorized source. "Seller provided document" and "Platform reviewed
   document" are different labels, forever.
6. **Trust is not for sale.** Sellers cannot buy badges or scores; advertising must never
   influence verification or ranking; sponsored inventory is always labeled.

## Why this expands beyond automotive

Nothing in the rails is car-shaped. The RYNEX core — durable asset identity, evidence-backed
provenance events, explainable trust scores, protected transactions, audit trail — is the
generic infrastructure for **any provenance-bound asset** traded in markets where records are
paper and fraud is cheap:

- **Bikes, trucks, tuk-tuks and machinery** — same passport, same odometer and ownership problems.
- **Fleet and logistics** — identity and history for hundreds of vehicles, already on the roadmap
  via Rynex Fleet.
- **Generators, solar systems, agricultural equipment, marine craft** — high-value, mobile,
  import-heavy assets where "what is this really and who owned it?" is the entire question.

The marketplace-vertical expansion path is: prove the trust rails on Kenya's hardest
provenance problem (used imports), then license the rails to adjacent asset classes via
Rynex API — the same way Stripe proved payments on one product and became infrastructure.

## 10-year north star

> **By 2036, no one in Africa should have to buy a vehicle — or any high-value used asset —
> on faith.** Every vehicle traded on RYNEX rails carries a living passport: verified identity,
> append-only provenance, explainable trust score, and a protected transaction trail. Banks
> underwrite against it, insurers price against it, dealers build businesses on it, and the
> question "how much uncertainty did we remove from this purchase?" — our north-star metric —
> trends toward zero. The marketplace got us into the room. The passport, the provenance graph
> and the trust engine are why we never leave it.

---

*Related: [Architecture](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Features audit](FEATURES.md) ·
[Market research](RESEARCH/) · [AI strategy](AI_STRATEGY.md)*
