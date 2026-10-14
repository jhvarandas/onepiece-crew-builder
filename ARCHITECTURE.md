# onepiece-x architecture

Status: designed and reviewed. Implementation started 2026-10-14: the engine (`shared/engine/`) and the v1 rules (`shared/rules/`) exist with tests; content, persistence and the app don't yet.
Last updated: 2026-10-14.

This document is the design for a learning sandbox: a One Piece–themed marketing site built with Nuxt, Contentful (free tier), Pinia and Supabase, hosted on Vercel (Hobby). It is written to teach. Every decision names the alternatives and says why one won. Sections marked **(review)** changed because a skeptic reviewer found a problem.

How it was produced:

- The owner wrote a brief, and the design was drafted in two phases.
- Six skeptic subagents attacked round one: simplicity; Contentful modeling; engine, persistence and rendering; AI product value; AI contract, security and operations; model choice.
- The owner then made seven decisions.
- Two more skeptics attacked what those decisions changed: runtime caching; slots, rules and names.
- On 2026-10-14 the owner settled all seven remaining open questions (D2, D3, D4, D13, D16, D17 and strict publishing).

Every verdict is in the [review log](#14-review-log).

## Contents

1. [Summary and decision log](#1-summary-and-decision-log)
2. [Constraints we verified](#2-constraints-we-verified)
3. [Principles](#3-principles)
4. [System overview](#4-system-overview)
5. [Content model (Contentful)](#5-content-model-contentful)
6. [Crews: positions and the compound-powers engine](#6-crews-positions-and-the-compound-powers-engine)
7. [Synergy rules: code or Contentful?](#7-synergy-rules-code-or-contentful)
8. [Persistence (Supabase)](#8-persistence-supabase)
9. [Crew names](#9-crew-names)
10. [Publishing and runtime caching](#10-publishing-and-runtime-caching)
11. [State: server data, Pinia and the URL](#11-state-server-data-pinia-and-the-url)
12. [Rendering per page type](#12-rendering-per-page-type)
13. [Phase two: AI as progressive enhancement](#13-phase-two-ai-as-progressive-enhancement)
14. [Review log](#14-review-log)
15. [Open questions](#15-open-questions)
16. [Sources](#16-sources)

---

## 1. Summary and decision log

**What we're building.** Three page types share one block vocabulary (hero, feature grid, CTA, testimonial):

- **Journey pages:** authored click-through stories, server-rendered and indexed.
- **Crew pages:** a configurator (`/build`) and saved, shareable crews (`/crew/[id]`).
- **Compare:** candidates side by side, plus each one's effect on your current crew.

A pure, deterministic compound-powers engine serves the configurator, compare and (in phase two) AI assistance. Phase one works completely without AI. Phase two adds AI as an optional layer that can only produce things a person could already produce by hand.

| # | Decision | Choice | Status |
|---|---|---|---|
| D1 | What a shared crew is | **Recipe**: store the choices, recompute on read, show a drift notice when today's result differs | Decided |
| D2 | Crew shape | **Positions (slots).** 12: the 10 Straw Hat positions plus 2 combatant slots; 100% in role, 50% off role | Decided |
| D3 | Where synergy rules live | In code for v1, as typed data; Contentful later, once rule kinds stop changing | Decided (review changed it) |
| D4 | Crew names | Generated only in v1, from a curated lexicon with reroll; never built from character names; user-entered names later | Decided |
| D5 | Chat copy | Written by the model; chat starts on Sonnet 5.5 at low effort | Decided |
| D6 | Content delivery | **Runtime publishing**: a synchronous snapshot builder on every publish, one fenced pointer, raw snapshots in Vercel Blob, CDN cache tags | Decided; details from review |
| D7 | Host | Vercel Hobby | Decided |
| D8 | Page types | `page` is journey-only; app routes compose blocks in code | Decided (review) |
| D9 | Calls to action | Inline on blocks: a label plus a target reference | Decided (review) |
| D10 | Engine inputs | Closed lists in code, mirrored into Contentful validations | Decided (review) |
| D11 | Entry identity | Readable `key` + `formerKeys` + `status: active/retired` | Decided (review) |
| D12 | Intent without AI | `objective` entries (stat weights, required positions) | Decided (review) |
| D13 | Body text | Restricted Rich Text (entry links only) | Decided |
| D14 | Engine location | `shared/engine/`, explicitly imported, lint-guarded | Decided (review) |
| D15 | AI models | Goal readings: Haiku 5.5 (medium effort). Chat: Sonnet 5.5 (low effort). An eval settles it | Decided |
| D16 | AI route isolation | No separate account in v1: edge rate limit, Turnstile, daily budget, separate Anthropic workspace and kill switch contain abuse | Decided |
| D17 | "Lore pick" AI reading | Deferred: not in v1. Hard filters plus the grounded catalog digest cover lore asks; revisit if the eval shows a gap | Decided |

---

## 2. Constraints we verified

Checked in October 2026. These shaped the design more than any preference did.

**Contentful free tier**

- 100K API calls per month, counted across the delivery, preview and management APIs together. When they run out, delivery and preview stop until the month ends.
- 25 content types, 50 fields per type, 10K records, 2 environments, 20 webhooks, 10 app definitions. Rate limits of 55, 14 and 7 requests per second (delivery, preview, management).
- Evaluation and non-commercial use only.
- Validation is per field: required, unique (checked at publish), predefined values, number range, array size, regular expressions (allow or prohibit), allowed link target types. There is no conditional or cross-field validation, no repeating field groups, and no write-once fields. Tightening a validation doesn't recheck existing entries until they're republished. A link to an unpublished entry comes back unresolvable.
- Webhooks wait 30 seconds for a response. They retry 429 and 5xx responses twice, about 30 seconds apart, and never retry timeouts.

**Supabase free tier**

- A project pauses after about 7 days of low activity; you restore it by hand.
- From 2026-10-30, new tables are not automatically exposed to the Data API; access needs explicit grants.
- Direct Postgres connections are IPv6-only, so serverless functions use the HTTPS client or the pooler.
- `jsonb` doesn't preserve key order or whitespace, so never hash bytes reconstructed from it.

**Vercel Hobby**

- Non-commercial use. No pay-as-you-go: when a usage allowance runs out, that feature pauses until the 30-day window resets, and allowances are shared by everything on the account.
- Functions (fluid compute): 300 s maximum duration; 4 h Active CPU, 360 GB-h memory and 1M invocations a month. Cron jobs run once a day, anywhere within their hour. One WAF rate-limit rule. Runtime logs are kept for 1 hour. No Skew Protection; Instant Rollback goes to the previous deployment only.
- CDN cache keys include the deployment, so every deploy starts with a cold cache. Query strings are part of the key for function responses. A function response is stored by the CDN only with `s-maxage` or a CDN-targeted header such as `Vercel-CDN-Cache-Control`.
- Cache tags: a response carries `Vercel-Cache-Tag` (Vercel strips it before the browser). Purging a tag can **invalidate** (serve stale, refresh in the background) or **delete** (the next request waits for a fresh render; an optional `revalidationDeadlineSeconds` keeps background refresh until the deadline). A purge clears the CDN cache, Runtime Cache and Data Cache together. Limits: 128 tags per response, 256 bytes per tag, case-sensitive, no commas. The purge helpers silently do nothing outside a Vercel request context.
- `waitUntil` and `getDeadline` from `@vercel/functions` keep work alive after a response and report the deadline. Nitro's own `event.waitUntil` isn't wired to them in the current Vercel preset (checked in nitropack 2.13.4's source), so work after the response can be frozen unless you wire it yourself.
- Runtime Cache: regional, shared by function instances in a region, survives deploys, evicts least-recently-used entries, items up to 2 MB. On Hobby, every project on the account shares one cache.
- Vercel Blob on Hobby: 1 GB storage, 10K simple operations (reads that miss the CDN), 2K advanced operations (uploads, lists) and 10 GB transfer a month. CDN hits don't count as operations.

**Nuxt 4 and Nitro**

- Nuxt 4.6.0 is current. Only `shared/utils` and `shared/types` auto-import; other `shared/` folders are imported explicitly, and nothing in `shared/` may import Vue or Nitro.
- Since 4.3, payload extraction (`_payload.json`) also applies to cached routes. CVE-2026-71316 (cross-user disclosure of cached payloads) affects 4.4.0 up to 4.5.1; use 4.5.1 or later. `experimental.payloadExtraction: false` keeps the payload inline in the HTML.
- Nitro's cache storage defaults to per-instance memory. Nitro's `isr` route rules map to Vercel ISR, which revalidates one path at a time. Hooks registered with `callHook` run one after another and rethrow errors.

**Claude (phase two)**

- Haiku 5.5 (`claude-haiku-5-5`): $0.10 / $0.50 per million input/output tokens; default effort `medium`; no server-side refusal fallback.
- Sonnet 5.5 (`claude-sonnet-5-5`): $2 / $10; default effort `high`; turning thinking off returns 400 (use effort instead); server-side refusal fallback covers only some categories.
- Structured outputs enforce enums, `const` and `anyOf`, but not string lengths, number ranges or array sizes, and not the capitalization of enum values. Schemas over 24 optional or 16 union-typed parameters are rejected, and an over-complex grammar returns 400 ("Schema is too complex for compilation"). A new schema compiles once (180 s hard limit), then is cached for 24 hours.
- The TypeScript SDK retries twice by default. The minimum cacheable prompt prefix is 512 tokens.

---

## 3. Principles

Every decision below traces back to one of these.

1. **Store intent, derive output.** Persist and pass around *choices* (keys). Compute everything else with pure functions. This applies to Supabase rows, Pinia, URLs and AI output alike.
2. **Closed vocabularies in code, open instances in content.** Block types, stats, roles, positions and rule conditions are fixed lists in code. Editors create instances of them.
3. **One renderer, many producers.** Components render one normalized block model. Contentful, code and later the AI are different producers of it.
4. **URL state can be server-rendered; session state can't.** Anything that must share or preview cleanly keeps its inputs in the URL.
5. **Every publish is a build.** A publish produces a validated, immutable content snapshot named by its hash, and exactly one mutable pointer says which snapshot is live. Each deployment derives its own view of that snapshot with its own code. The live site never calls Contentful.
6. **The AI can only do what a person can already do by hand.**

---

## 4. System overview

```
PUBLISH (runs inside the webhook request)
Contentful ──signed webhook──► /api/hooks/content
                                 take the build lease (generation g), or answer 503
                                 fetch whole space → normalize → hash R → validate with this code
                                 upload raw/<R>.json to Vercel Blob
                                 promote(R, g) in Postgres (fenced)
                                 wait out the longest render → purge tag "content" → check the canary
                                 release the lease (only if no new events)

REQUEST
Browser ──► Vercel CDN ──hit──► cached HTML (tagged)
                 │ miss
                 ▼
           Nuxt SSR (Vercel Function)
             read the pointer once (Supabase, 300 ms timeout) → R
             derived snapshot for (this build, R): memory → Blob → derive and validate
             shared/engine evaluates crews; crews table for /crew/[id]
             respond with hashes in the payload + cache headers + tags

BROWSER
Block renderer + Pinia (draft crew, compare tray, session) + shared/engine (search in a Web Worker)
fetches /api/catalog/<build>/<catalogHash> (immutable)
```

Modules:

- `shared/engine/`: pure TypeScript, no framework or vendor imports (lint rule). Used by browser and server. The rules live next to it as typed data (v1).
- `server/content/`: the webhook builder, the snapshot loader, the Contentful adapter (entries to domain types and block models), and validators.
- `server/crews/`: Supabase repository and save validation through the engine.
- `app/`: block renderer and four block components, page shells, widgets (configurator, crew sheet, compare table, suggestions panel), Pinia stores, composables.
- Phase two adds `server/assist/`, `/api/assist/*`, `/explore` and a suggestions-panel provider. No phase-one module imports them.

---

## 5. Content model (Contentful)

### 5.1 What Contentful stores is not what components render

An adapter converts entries into one block model (`hero | featureGrid | cta | testimonial`). Components never see Contentful's response shapes or link resolution.

- *Alternative:* components read entries directly. Fewer files, but code-built and AI-built pages would have to fake Contentful entries.
- *Alternative:* the GraphQL API with generated types. Typed, but still shaped like the CMS, so you'd map it anyway.
- *Why:* principle 3. This layer is also where editor mistakes are caught.

### 5.2 Content types (12 of the 25 allowed)

| Type | Holds | Notes |
|---|---|---|
| `page` | title, slug, blocks, concepts, SEO fields, `indexable` | journey pages only |
| `blockHero` | internal name, headline, subheadline, media or featured character, action | |
| `blockFeatureGrid` | internal name, heading, intro, items (feature items, characters, abilities, presets) | |
| `blockCta` | internal name, heading, body, action | |
| `blockTestimonial` | internal name, quote, speaker (character) or attribution, context | |
| `featureItem` | title, body, icon | |
| `character` | key, former keys, status, name, epithet, portrait, bounty; **engine fields:** stats, roles, power type, faction, Haki (closed lists); concepts; abilities | the engine reads only the closed fields |
| `ability` | key, name, kind (`devilFruit`, `haki`, `technique`, `compound`), description | compound abilities are the "compound powers" |
| `crewPreset` | key, name, **one reference field per position** (captain required), description, concepts | showcase crews, CTA targets, compare context |
| `objective` | key, name, stat weights 0–5, required positions, goal concepts | connects intent to the engine without AI |
| `concept` | key, label, facet, synonyms, description | discovery and AI grounding only |
| `siteSettings` | navigation, footer, app-page chrome, **name lexicon** | single entry |

Later: a `comparePage` type for curated "Zoro vs Sanji" pages, where Contentful itself can require 2–4 characters; and rule types if rules move to Contentful ([section 7](#7-synergy-rules-code-or-contentful)).

### 5.3 Decisions

**`page` is for journeys only (review).** The crew and compare routes build their blocks in code around their interactive widget. That's still one block model, and it rehearses phase two, where the AI is another producer outside Contentful.

- *Original:* one `page` type with a `template` field and fixed "shell" entries for app routes.
- *Why it lost:* Contentful validates fields one at a time and never conditionally, so a `template` field moves all validation into code, where editors only discover mistakes in preview.

**Calls to action are inline (review).** Each block holds a label and a `target`: one to four references whose type implies the behavior.

| Target | Becomes |
|---|---|
| one page | a link |
| one preset | `/build?preset=…` |
| one objective | `/build?obj=…` with the objective as lens and Auto-fill offered |
| one to four characters | `/compare?c=…` |
| external URL | a plain link |

A mix of types is rejected when the snapshot is validated.

- *Original:* separate `action` entries.
- *Why it lost:* linked entries publish separately, so a page could go live while its new CTA is still a draft, and the delivery API silently leaves it out. Pickers also fill up with identical "Learn more" entries.
- The objective target exists so that everything the AI can link to in phase two can also be authored by hand (principle 6).

**Engine inputs are closed lists (review).** Stats, roles, positions, power type, faction and Haki are fixed lists in code. The content-model migration scripts copy the same lists into Contentful's "accept only specified values" validation, so there is one source of truth. Concepts stay open but are only for discovery; the engine never reads them.

- *Why:* if the engine read open tags, adding a "musician" tag for one page would change every saved crew.
- **Faction** means current canon affiliation. Jinbe has been a Sun Pirate, a Warlord, a Big Mom ally and a Straw Hat. Arc-specific versions, if wanted, become separate characters ("Jinbe (Warlord)").

**Keys and lifecycle (review).**

- Every domain entry has a readable `key`, used by the engine, URLs, Supabase and the AI.
- `formerKeys` keeps old keys working after a typo fix.
- `status: retired` replaces unpublishing. Retired characters still appear in old crews but vanish from pickers.
- *Why:* the free plan has no write-once fields and no referential integrity. A link to an unpublished entry simply disappears, which would silently shrink presets and break rules.

**Semantic tagging.** A `concept` belongs to one fixed facet (theme, arc, affiliation, Devil Fruit, goal, audience) and carries synonyms and a description.

- *Alternative:* Contentful's built-in tags. Flat and without synonyms, so fine for editorial labels only.
- *Alternative:* Contentful Taxonomy. The native answer, but we couldn't confirm it's on the free plan.
- *Alternative:* fixed value lists per content type. No synonyms, and every vocabulary change needs a migration.

**Objectives (review).** Concepts alone only support word matching. Ranking a crew needs stat weights that no content defined. An `objective` supplies them, for example "Grand Line Survivors: navigation 5, medicine 4, needs a doctor".

- The pipeline becomes text → concept → objective → engine → real entries, all deterministic.
- It powers "Auto-fill for this goal" and "fill the gap" in phase one, and becomes the closed list the AI picks from in phase two.

**Body text (decided 2026-10-14).** Restricted Rich Text in `body` fields, allowing only links to other entries. Those links survive renames, connect journeys and help SEO.

- *Alternative:* plain text. Safer and simpler, but loses rename-safe inline links.
- The original reason for plain text (parity with AI-written copy) disappeared once the AI stopped writing body text.

### 5.4 Editorial workflow and content-model changes

- The content model is defined as migration scripts in the repo, with a `dev` environment for trying them.
- Preview is a separate Vercel deployment that reads the preview API on each request (with a few seconds of memory caching), because cookie-based preview breaks inside Contentful's Live Preview frame in Safari. Preview shows a banner when the live site is behind Contentful (a rejected build).

**Expand, then contract.** With runtime publishing, a careless content-model change blocks every publish. A new required field without values makes every snapshot fail validation. So:

1. Deploy code that tolerates both the old and new shape (it ignores unknown fields and defaults new optional ones).
2. Change the content model and backfill values in the migration script.
3. Only then make the field required, or remove the old one.

**Tighten validators gradually.** A stricter validator in our code applies to every entry at the next build, while Contentful's own validations recheck nothing until entries are republished. Ship a new rule as a warning first, fix the content, then make it an error.

---

## 6. Crews: positions and the compound-powers engine

### 6.1 What positions change

With sets, a crew was a bag of characters, and the engine only asked who is present. With positions (slots), a crew is an assignment of characters to positions, so the engine also asks **who is where**. That one change touches nearly everything:

| Area | Set (before) | Positions (now) |
|---|---|---|
| Engine input | sorted list of keys | map of position to key |
| Stats | crew-wide aggregators (navigation = best navigator, combat = sum) | **combat is shared**: everyone adds to it. **Every other stat belongs to one position**, and only its occupant supplies it |
| Rules | who is present | who is present, **who is in which position**, which attributes sit where |
| Coverage | which roles are present | which positions are filled, in role or off role |
| Search | choose a subset | choose a subset **and** an assignment |
| Compare | add or replace a member | "who's the best navigator for this crew?": candidates compared in one position |
| URL | `?m=luffy,zoro` | `?s=captain.luffy~first-mate.zoro` |
| Storage | `members text[]` | `slots jsonb` |

### 6.2 The positions (code)

Decided (2026-10-14): the 10 Straw Hat positions plus 2 combatant slots, with occupants giving 100% of a position's owned stat in role and 50% off role. **Captain** is required to save; the rest are optional; a character can occupy one position at most.

| Position | In role for | Owns stat |
|---|---|---|
| captain | captain | leadership |
| first-mate | fighter, swordsman | (none: a combat position) |
| combatant ×2 | fighter, swordsman | (none: combat positions) |
| navigator | navigator | navigation |
| sniper | sniper | precision |
| cook | cook | provisions |
| doctor | doctor | medicine |
| archaeologist | scholar | knowledge |
| shipwright | shipwright | shipcraft |
| musician | musician | morale |
| helmsman | helmsman | helm |

Stat names are placeholders for the real list. Each position is a code definition: key, label, the roles that are in role, and the stat it owns.

**Why two combatant slots (review).** Most of a ~200-character roster are fighters or captains. With only the ten canonical positions they'd crowd one slot, while musician, shipwright, archaeologist and helmsman have one to three natural candidates each. Combat positions give fighters a home that doesn't cost the crew a specialty. The two combatant slots are interchangeable, so canonicalization sorts their occupants. The snapshot builder warns when a position has fewer than 3 in-role candidates or a character is in role nowhere.

- *Alternative:* the canonical ten only. Truest to canon; fighters crowd one slot.
- *Alternative:* 6–8 positions. Simpler, but Robin, Franky, Brook or Jinbe lose their natural homes.
- *Alternative:* users pick a set and the engine assigns positions. Simple input, but positions become output, so they'd shift whenever the assignment logic changes, and nobody gets to put Zoro at the helm for fun.

### 6.3 Evaluation pipeline

1. **Canonicalize and validate.**
   - Order positions by the code-defined order, and sort the occupants of interchangeable slots.
   - Check that position keys exist, no character appears twice, and characters are active (for new saves).
   - Captain must be filled to save.
2. **Base stats.**
   - **Combat** is the sum of every occupant's combat, wherever they sit.
   - **Each owned stat** comes only from the occupant of its position: 100% in role, 50% off role (one global pair), rounded down. An empty navigator position means navigation 0.
   - A fighter at navigator still adds full combat, but only half of their (usually low) navigation.
   - *(Review: summing every stat for everyone meant five off-role navigators could out-navigate Nami.)*
3. **Rule conditions.** Read occupants' own data, their positions and base stats, never another rule's result. Rules never chain.
4. **Effects.**
   - v1 has two operations: **add** and **cap**. Each effect declares its scope: one position's contribution ("Nami at navigator: navigation +10") or the crew total.
   - All adds combine first, totals clamp at zero, then the lowest cap applies, so order can never change a result.
   - Percentage modifiers can come later as additive percentage points with one final rounding (+50% and +20% make +70%, never ×1.8). That keeps integer math exact.
   - *(Review: the earlier multiply operation had undefined scope and could overflow or amplify negative numbers.)*
5. **Unlocks** of compound abilities, and **position status**: in role, off role or empty.

All numbers are integers. Every result carries a trace (per-position contributions and which rules fired with what effect). Explanations use **leave-one-out** ("without Robin: −18 knowledge, loses *Poneglyph Reader*"), which doesn't depend on how the crew was built. The phase-two AI narrates the same trace.

### 6.4 Rules (typed data in code, v1)

A rule is a set of conditions that must all hold, one or more effects, and optionally a compound ability it unlocks.

| Condition | Means | Example |
|---|---|---|
| `character(X, position or any)` | X is in the crew, optionally in a given position | Luffy at captain |
| `attribute(attr = value, position or any, at least N)` | occupants with a closed attribute | a Devil Fruit user at helmsman; 3+ Devil Fruit users |
| `anyOf(k, characters)` | at least k of a list are in the crew | any 3 of the Worst Generation |
| `baseStat(stat ≥ n, position or crew)` | a base-stat threshold, before rules | crew navigation ≥ 60 |

Example rules:

| Rule | Conditions | Effect |
|---|---|---|
| Monster Trio | Luffy, Zoro and Sanji, anywhere | combat +6 (crew); unlocks *Monster Trio* |
| Hopelessly Lost | Zoro at navigator | navigator contribution capped at 0 |
| King and Swordsman | Luffy at captain, Zoro at first mate | unlocks *King and Swordsman* |
| Brothers | Luffy at captain, Ace anywhere | leadership +5 |
| Can't Swim | a Devil Fruit user at helmsman | helm −4 |
| Supernovas | any 3 of the Worst Generation | combat +3 |

Checks that types can't express (X ≠ Y, every referenced key exists or is a former key, the unlocked ability is a compound ability) run in CI and again when a snapshot is validated.

### 6.5 Search becomes an assignment problem

`complete`, `improve` and `rank` used to choose subsets. Now they choose subsets and positions, and exhaustive search is impossible: about 200 characters across up to 11 empty positions.

- **A rule index** (by character and by attribute) is built once per snapshot.
- **`complete(crew, objective, {pins, exclusions, pools})`** fills empty positions greedily:
  1. Apply the best single move. A move places one character, or places a pair that completes a rule found through the index. The pair moves catch synergies where neither character is in the crew yet.
  2. Record the reason for each move ("Nami → navigator: +40 navigation").
  3. Finish with one pass of swaps.
  4. Results are deterministic, with ties broken by key.
- **`improve(crew, objective)`** runs the swap pass on a full crew. Without it, "make my full crew stealthier" would return the same crew.
- **`rank`** only works under an objective lens. Without one, there's nothing honest to rank by.
- **It runs in a Web Worker** in the browser. On the server it runs only behind the AI route's rate limits, because Hobby's CPU allowance is shared and hitting it pauses the site.
- The UI says "suggested", never "optimal", and shows each step's reason.
- *(Review: a beam search with local search was replaced. Its results jumped around when one character was pinned, and nobody could explain them step by step.)*

### 6.6 Compare (review)

Compare state lives in the URL: `/compare?c=robin~brook&s=…&slot=archaeologist&obj=…`.

- **Compare within one position.** By default each candidate appears at its in-role position; any other position is a click away. In one position, every candidate affects the same stats, so the side-by-side is honest.
- **No ranking without a lens.** Without an objective there's no single score and no ordering; candidates keep tray order. With an objective, each candidate gets a score and a candidate × position heatmap appears.
- **Pairs come from the rule index:** rules that name both candidates, or attribute rules both satisfy. Each pair is shown with the rule that explains it.
- *(Review: placements in different positions touch different stats, so the earlier "show every non-dominated placement" view showed nearly everything, and ranking by best placement smuggled in a hidden score. Brute-force pair search over caps also produces fake "interactions".)*

### 6.7 Engine API, location, versions and tests

- **Operations:** `evaluate`, `diff`, `explain` (leave-one-out), `place`, `replace`, `move`, `remove`, `pairsFromRules`, `rank` (needs a lens), `complete`, `improve`, `validateCrew`.
- **Phase one already takes pins, exclusions and pools** in `complete` (roster filters and exclusions are URL state), so phase two adds no engine functions.
- **Location:** `shared/engine/`, imported explicitly as `#shared/engine`, with a lint rule banning Vue, Nitro, Contentful and Supabase imports. Extract to a package when something outside Nuxt needs it. *(Review: the original design wanted a package because it wrongly assumed everything in `shared/` auto-imports.)*
- **Versions:** `engineVersion` (bumped when evaluation semantics change) plus the content hashes.
- **Tests:**
  - Same input, same output.
  - Input order and interchangeable-slot order don't matter.
  - Diffs agree with evaluations.
  - JSON round-trip.
  - Rule order never changes a result.
  - Golden crews (the Straw Hat preset, joke placements) with expected outcomes.
  - Builder warnings for thin positions.

---

## 7. Synergy rules: code or Contentful?

**The question.** A rule has a *kind* (which conditions and effects exist, and how they're evaluated) and *instances* (Zoro + Sanji, the numbers). Kinds always live in code, because they're engine behavior. The question is only where instances live.

| | A. Code (typed data) | B. Contentful | C. Hybrid |
|---|---|---|---|
| Who edits | developers | anyone in the Contentful UI | structure: developers; numbers: Contentful |
| How a change goes live | deploy | publish → snapshot builder → live in seconds | numbers live; structure via deploy |
| Shape checking | the compiler (illegal rules can't be written) | Contentful per field; cross-field checks at snapshot time | both |
| Expressiveness | anything: composed conditions, several effects | limited by content types (no nesting, no repeating groups) | anything |
| References | string keys, checked against content on every build | real links, rename-safe | keys |
| History and review | git diff, blame, revert | per-entry version history | split |
| Tests | golden tests in CI on the real rules | need exported fixtures | split |
| Content types | 0 | +3 | +1 |

**I first recommended B. The slots/rules skeptic changed my mind (review):**

- **Rule semantics will churn** while the engine is young. Scope, conditions and new kinds are all still settling. In B every such change costs a content-type migration, a rewrite of every rule entry through the management API, and an expand/contract deploy.
- **Rules aren't needed to learn runtime caching.** Character stats, presets, objectives and pages already run the whole loop: publish, validate, promote, purge, recompute, and show a drift notice on saved crews.
- **The biggest balance lever stays in code anyway.** Position definitions and the fit percentages live there whatever you choose.
- **A's main cost is mostly gone.** Code naming a retired or renamed character is handled by `formerKeys` and `status: retired`.

**Decision (2026-10-14): A for v1.** Rules are typed data in code, shaped like what a Contentful adapter would emit. Golden tests run on the real rules. Later, once rule kinds stop changing, choose:

- **C, live tuning.** A `ruleTuning` content type holds the numbers. Its `ruleKey` field only accepts keys mirrored from code (the same pattern as other closed lists), so Contentful validates every tuning entry.
- **B, full.** An export script writes the rules into Contentful, modeled as one `rule` type plus two condition types (`condCharacter`, `condAttribute`) linked from it, with a separate amount field per operation, each with its own range. Two more pieces make B safe:
  - **A Contentful field app** that runs our validator inside the editor (the free plan allows 10 app definitions). Its "invalid" state only draws a warning, so blocking publication needs a required helper field the app fills only when the rule is valid.
  - **Per-entry hold-back** in the builder, so one bad rule can't freeze every publish.

---

## 8. Persistence (Supabase)

### 8.1 Recipe, not photo (decided)

| | Store choices, recompute on read | Store the computed result |
|---|---|---|
| Source of truth | one (content + engine) | two (stored result vs current rules) |
| Balance change | every crew updates; a shared link can change | frozen; the link is a photo |
| Engine bug fix | repairs old crews | old crews keep wrong numbers |
| Forgery | only keys to validate | a posted result must be recomputed anyway |
| Output format change | free | readers for every old format |

**Drift.** Each saved crew stores the catalog hash, engine version and a small summary of the result at save time. The page says "recalculated under current rules" only when today's result actually differs from that summary. Comparing hashes alone cries wolf: adding an unrelated character changes the hash.

- *Alternative:* store the computed result. A photo that goes stale and needs readers for old formats.
- *Alternative:* pin each crew to the snapshot it was saved under. Reproducible forever, at the cost of keeping every snapshot and running old engine versions.

### 8.2 Tables

```
crews
  id               text primary key        -- 10-char random base62
  slots            jsonb not null          -- {"captain":"luffy","navigator":"nami"}
  name             text not null           -- the crew's identity; never recomposed
  name_recipe      jsonb null              -- pattern + words, for generated names
  name_source      text not null           -- generated | user
  catalog_hash     text not null           -- engine-relevant content at save time
  engine_version   int  not null
  summary_at_save  jsonb not null          -- totals + unlocked ability keys
  parent_id        text null               -- remix lineage
  client_key       uuid unique not null    -- idempotency for retried saves
  created_at       timestamptz default now()

content_pointer    singleton: raw_hash, catalog_hash, pages_hash, promoted_by_generation, promoted_at
content_snapshots  raw_hash pk, catalog_hash, pages_hash, bytes, blob_url, created_at
content_lease      singleton: generation, holder, expires_at
content_events     entity_id, revision, received_at, processed_at
content_builds     trigger, timings, delivery-API calls, hashes, result, errors, purge result, canary result
crew_moderation    crew_id pk, hidden, reason, at          -- only if user-entered names ship
ai_budget          day pk, reserved, spent                 -- phase two

functions: acquire_lease(), renew_lease(g), promote(raw_hash, …, g), release_lease(g), reserve_budget(…)
```

- **Insert-only crews.** Editing is a remix that creates a new row, so a shared link never changes under the person viewing it.
- **`slots` as jsonb.** One row per save means one atomic insert through the HTTPS client. The engine validates the contents, since Postgres can't see the catalog anyway.
  - *Alternative:* a child table `crew_slots(crew_id, position, character)` with uniqueness constraints, inserted atomically through a Postgres function. Better for questions like "most popular navigator". Switch if you want those analytics.
- **Lease and pointer updates are Postgres functions** called through RPC. The HTTPS client can't express "increment the generation" or "now plus one minute" in an update, and keeping these invariants in the database is the point of the lesson.
- **Server-only access.** The Nuxt server uses Supabase's HTTPS client with a secret key. Row-level security stays on and only the server role gets grants (matching Supabase's new default).
  - *Why:* validating a crew needs the catalog, one write path is easier to secure, and no database key ships to browsers.
  - *Alternative:* the browser writes under row-level security. That validates the row's shape, not whether its characters exist.

### 8.3 Saving

- The client sends the slots, the name recipe, a `client_key` and the catalog hash it was looking at.
- The server validates the choices against the current pointer. It returns 422 only if a choice became invalid, such as a retired character or a removed word.
- It computes `summary_at_save` itself and tells the client when the numbers changed since the draft was evaluated.
- *(Review: an earlier draft returned 409 whenever the content had moved, so a homepage typo fix would have rejected every in-flight save. That fought the recipe model, where only the choices matter.)*

### 8.4 Operations (required, not stretch)

- A daily cron keeps Supabase awake. A paused project breaks every shared link and freezes publishing.
- When Supabase fails, crew pages and saves return 503 with no caching, never a 404 a cache would keep.
- The Vercel function region sits next to the Supabase region.
- Copying crews into a key-value store so links survive a pause stays optional.

---

## 9. Crew names

You said generated names would be fun, or user-entered ones. Both work, with very different costs.

**Generated (decided for v1).**

- Names come from patterns and word lists in `siteSettings`, such as "The {adjective} {noun} Pirates".
- The draft offers a name and a **reroll** button.
- **The save sends the name's recipe** (pattern and words), not the text. The server composes the name from the live lexicon, so there's no free text and nothing to moderate.
- **Character names never go into patterns (review).** "Monkey" is Luffy's family name and "Black" is a canon adjective, so innocent words can combine into a slur. A captain-epithet pattern would also name every Luffy-led crew "Straw Hat Pirates": identical preview cards that read as the canon crew.
- **The builder checks every pattern × word combination** against a phrase deny-list, and the lexicon fields use Contentful's prohibit-regex validation.
- **Words are keyed by their text.** List items in Contentful have no ids: index keys break when the list is reordered, and text keys survive it.
- Both the composed text and its recipe are stored. The text is the crew's identity and never changes. The recipe lets you find and hide every crew using a word you ban later.
- If a word disappears between draft and save, the save returns 422 and the draft rerolls only that word.

**User-entered (not in v1; later).** Free text needs a pipeline:

- Unicode normalization, an allowed character set, 3–40 characters, a blocklist, Turnstile and rate limits.
- A takedown path that keeps crews insert-only: a `crew_moderation` row hides the name, the page falls back to a generated one, and the crew's cache tag is **deleted** so the name disappears from Vercel's cache immediately.
- **User-entered names never appear in link previews (review).** Slack, Discord and X keep their own copies of previews for days, and no purge reaches them. Previews show the generated name and the lineup.

**Ids.** Random 10-character ids, no longer derived from the members, since two people can save the same crew under different names. A client idempotency key dedupes double-clicks and retries.

---

## 10. Publishing and runtime caching

This is the part you chose to learn. The design keeps three guarantees from the earlier "content is a build input" plan while publishing without a deploy:

1. The live site never calls Contentful per request (quota and outages can't take it down).
2. Every response uses exactly one content version.
3. Invalid content never goes live.

The trick is to **make everything immutable except one pointer**. Immutable things can be cached anywhere, forever, without invalidation. All freshness logic then concentrates on one small mutable thing.

### 10.1 A snapshot depends on content *and* code (review)

The first draft stored the transformed catalog and had every deployment read it. But that transform is code. After a deploy that adds a catalog field, or after an Instant Rollback, a deployment would read a snapshot built by different code and crash or mis-render. Hobby has no Skew Protection to paper over this. So there are two keys:

- **The raw snapshot `R`** is the whole published space, normalized (stable order, editor-only metadata stripped) and serialized to bytes. It doesn't depend on our code. One global pointer names the live `R`.
- **The derived snapshot** is the catalog plus page models, produced and validated by a deployment's own code. It's keyed by `(build, R)`, where `build` is the deployment's build id. Later, `build` can become a hash of only the transform, validator and engine code, so unrelated deploys keep caches warm.

Each instance derives lazily (a transform of a few hundred entries takes milliseconds) and remembers the result. A deployment that finds `R` invalid under its own code, for example after a rollback, serves its last valid derived snapshot or its baked seed. It marks responses stale and logs an alert.

The raw snapshot also carries two sub-hashes:

- `catalogHash` covers everything the engine reads: characters, abilities, presets, objectives, the name lexicon.
- `pagesHash` covers journey pages and site settings.

Clients pin only what they use, and copy-only publishes don't invalidate catalog caches.

### 10.2 The publish path

It runs synchronously inside the webhook request (review).

1. **Receive.** Contentful sends a signed webhook (`master` environment; publish, unpublish, archive and delete events) to `POST /api/hooks/content`. The handler verifies the signature over the raw body and exact path, then records the entity and revision in `content_events`.
2. **Take the lease, or answer 503.** `acquire_lease()` increments a generation number and returns it when the lease is free. If another build holds it, the handler answers **503 with Retry-After**. Contentful retries twice, about 30 seconds apart, which becomes a natural re-kick. *(Review: running the build after the response doesn't work. Nitro's `event.waitUntil` isn't wired to Vercel's `waitUntil` today, so the build would be frozen mid-run, holding the lease.)*
3. **Build, with the lease** (the whole loop stays under about 20 seconds; Contentful waits 30):
   1. **Fetch** the whole published space from the delivery API (a few calls). Check that every recorded revision is visible. If not, back off and refetch, because the delivery API can lag a webhook by seconds. *(Review: otherwise the build sees the old content, finds nothing changed, and drops the publish.)*
   2. **Normalize and hash** `R`. If it equals the live pointer, there's nothing to do.
   3. **Transform and validate** with this deployment's code: references resolve, cross-field checks pass, keys are unique (also ignoring case), enums are valid, presets are valid crews, CTA targets resolve, and the name lexicon passes the deny-list check. Errors are logged as a rejected build; the pointer doesn't move. The handler still answers 200, because a retry won't fix content.
   4. **Upload** the raw bytes to Vercel Blob at `raw/<R>.json`. Content-addressed, so the upload is idempotent. Then index the snapshot in `content_snapshots`.
   5. **Promote, fenced.** `promote(R, …, g)` moves the pointer only if `g` is still the current, unexpired lease generation. A builder whose lease expired, or one frozen and later resumed, can't overwrite newer content. *(Review: a compare-and-swap on the pointer proves "nobody else wrote", not "my content is newer".)*
   6. **Wait out the longest possible render, then purge.** Renders time out after 8 seconds, so the builder waits about 10 seconds, then deletes the tag `content`. It records the purge result and retries once on failure. *(Review: a render that read the old pointer just before promotion could otherwise land in the CDN after the purge and stay there.)*
   7. **Check the canary.** Fetch `/__canary` through the CDN and confirm its `x-content-hash` equals `R`. Record the result.
   8. **Release or loop.** Mark events processed. `release_lease(g)` succeeds only if no unprocessed events remain, in one atomic statement. Otherwise loop, within the time budget.
4. **Safety nets.** A daily cron keeps Supabase awake, rebuilds and compares (catching missed webhooks), retries failed purges, and prunes snapshots. It keeps at least 7 days *and* at least the last 20.
5. **`/status`** (protected) shows the pointer, recent builds with timings, delivery-API calls, errors, purge and canary results. It has buttons to roll back (promote the previous `R`) and to rebuild.
6. **Strict in v1 (decided 2026-10-14).** Invalid content blocks promotion and the previous snapshot keeps serving. You are the only editor, rules live in code, and preview shows a banner when the live site is behind. Holding back a single bad entry instead is a later ladder level.

### 10.3 The read path

| Layer | Holds | Keyed by | Invalidated by | If it fails |
|---|---|---|---|---|
| Vercel CDN | whole HTML and JSON responses | URL + deployment | tag purge on promotion; deploys start cold; 1-hour lifetime as a backstop | — |
| Instance memory | derived snapshots | (build, R) | never (immutable) | cold start → next layer |
| Vercel Blob | raw snapshot bytes | R | never (immutable) | baked seed, marked stale |
| Supabase | the pointer, the snapshot index, crews | — | `promote()` | pointer: 503, CDN keeps its last good copy; crews: 503 |
| Baked seed | raw and derived snapshot at deploy | build | next deploy | — |

- **Read the pointer once per request** (Supabase over HTTPS, 300 ms timeout, circuit breaker). Store it in the request context and pass it to every internal fetch, so one response can't mix versions. Never keep the pointer in memory between requests.
- **When the pointer can't be read**, answer 503 with Retry-After and a body rendered from the baked seed. The CDN keeps serving its last good copy on errors. A 200 rendered from older content would overwrite a newer cached page.
- **Vercel Runtime Cache is not in v1** (review). It's non-durable, the Hobby page lists no allowance for it, and on Hobby all your projects share one. It's a ladder level. When added: set a `namespace` and store the hash inside cached values so reads can be checked.
- **The baked seed** is the raw snapshot current when the deploy was built, plus its derived form, validated by that deploy's code (an invalid one fails the build). It's the floor during outages and the fallback after rollbacks.
- **Why Blob for snapshots and Supabase for the pointer (review).** The pointer needs strong consistency, which Postgres gives. Snapshot bytes need cheap, immutable, CDN-backed reads; Blob gives that, and CDN hits don't count as operations. `jsonb` would also reorder keys, breaking re-hashing.
  - *Alternative:* `bytea` in Supabase, which avoids a new service.
  - *Rejected:* Global Config (Edge Config): 100 writes a month on Hobby, and reads may return an old value while the new one loads.
  - The Blob store is public: it holds only published content, so don't put secrets in Contentful.

### 10.4 CDN policy per route

| Route | CDN cache | Tags | Indexed |
|---|---|---|---|
| journeys `/`, `/[...slug]` | `Vercel-CDN-Cache-Control: s-maxage=3600`; browsers revalidate | `content`, `page:<slug>` | yes |
| `/build?s=…` | same | `content` | canonical `/build` |
| `/crew/[id]` | same | `content`, `crew:<id>` | no |
| `/compare?…` | same | `content` | no |
| `/api/catalog/<build>/<catalogHash>`, `/api/page/<build>/<pagesHash>/<slug>` | `Vercel-CDN-Cache-Control: max-age=31536000` plus browser `immutable` | none | — |
| `/og/crew/[id]` | long; content that doesn't drift (portraits, generated name) | `crew:<id>` | — |
| 404 pages, sitemap, `/__canary` | as journeys | `content` | — |
| `POST /api/crews`, `/api/assist/*`, `/api/hooks/*` | never | — | — |
| preview deployment | never; reads the preview API | — | no |

- **Delete, not invalidate, at this traffic (review).**
  - Invalidation serves the old page to the next visitor while a fresh one renders. With few visitors, that next visitor is usually you, right after publishing.
  - Devtools' "Disable cache" hides this, because it makes Vercel revalidate synchronously.
  - Deleting makes the next request render fresh. Stampedes don't matter at sandbox traffic.
  - Invalidation is the better default at high traffic. Try both at ladder level 4 and watch `x-vercel-cache`.
- **Canonical URLs are also cache keys.** Query strings are part of the CDN key, so non-canonical forms redirect to the canonical one. Tracking parameters (`utm_*`, `fbclid`) are stripped.
  - Redirects are **307**, cached only at the CDN. *(Review: browsers cache 301s on their own, which can loop if the canonical order ever changes.)*
- **No `Set-Cookie` or `Vary: Cookie` on cached routes.**
- **`robots.txt` disallows the query-string variants** of `/build` and `/compare`. Crawlers would otherwise burn Active CPU, and Hobby pauses for 30 days when a limit is hit.
- **Why not Nitro's `swr` route rules?** Nitro's cache defaults to per-instance memory on serverless, so instances disagree.
- **Why not Vercel ISR?** It revalidates one path at a time, crew pages can't be enumerated, and ISR writes are a Hobby allowance. Plain HTTP cache headers plus tags are explicit and portable, and they teach HTTP caching itself.
- **Nuxt settings:** Nuxt 4.5.1 or later; `experimental.payloadExtraction: false`, so a page's HTML and its data are one response and can't come from different versions.

### 10.5 Two clocks in the browser: code and content

- **Pinned fetches.** Server-rendered pages carry the build id and the hashes. Every client fetch names them: `/api/catalog/<build>/<catalogHash>`. Because the URL names every input that affects the bytes, browsers and the CDN can cache it forever.
- **A fetch the server can't serve** (a pruned snapshot, or another deployment's build id) returns 410, and the client does a full reload. A guard in sessionStorage stops a loop if the reload gets the same stale HTML.
- **No polling in v1 (review).** A tab keeps its content version until a full page load; new content arrives with the next one. Back/forward-cache restores behave the same way.
- **New deploys** are detected by Nuxt's app manifest.

### 10.6 Failure modes

| Failure | What happens |
|---|---|
| Contentful down or out of quota | Nothing visible. Publishing pauses; the site serves the current snapshot. |
| Invalid content published | Build rejected; pointer unchanged; errors on `/status` and a banner in preview. |
| Webhook missed or all retries busy | Daily cron reconciles; a rebuild button on `/status`. |
| Delivery API lags the webhook | Revision check backs off and refetches. |
| Builder frozen or crashed mid-run | The lease expires; fencing stops it from promoting later; the next webhook or cron rebuilds. |
| Purge fails | Recorded and retried; the canary flags it; the 1-hour lifetime heals the rest. |
| Supabase unreachable | Pages the CDN already holds keep being served; uncached pages get 503 with a seed-rendered body; saves return 503. |
| A deploy or rollback | The CDN starts cold; each deployment derives its own snapshot; a mismatch falls back to the seed and alerts. |

### 10.7 Observability

Hobby keeps runtime logs for one hour, and the purge helpers fail silently outside a Vercel request, so the system records its own evidence:

- **`content_builds`** keeps a row per build: trigger, timings, delivery-API calls, hashes, result and errors, purge result, canary result.
- **Response headers:** `x-content-hash`, `x-snapshot-source` (memory, blob or seed), `x-pointer-ms`, and `x-cache-tags`, an echo of the tags because Vercel strips its own tag header.
- **The canary** after every promotion proves the purge reached the CDN.
- **`x-vercel-cache`** (HIT, MISS, STALE, REVALIDATED) shows what the CDN did.

### 10.8 The caching ladder (learning milestones)

Each level ships on its own and adds one idea.

1. **Baked content only.** Server-render every request from the snapshot built at deploy. Pages work.
2. **Runtime publishing.** Add the webhook builder, raw snapshots in Blob, the fenced pointer, validation, and per-deployment derivation. Publish in Contentful and see it on the next request. *Lesson:* immutability, leases and fencing tokens, the validation gate, code and content as separate keys.
3. **CDN caching by time.** `s-maxage=60, stale-while-revalidate=600`, no purging. *Lesson:* freshness versus cost.
4. **Tag purging.** Long lifetimes, purge on promotion, the canary. Try invalidate, then delete. *Lesson:* purge timing, and why stale-while-revalidate behaves differently at low traffic.
5. **Layers and pinning.** Versioned API URLs, 410 with the reload guard, then Vercel Runtime Cache, measured. *Lesson:* cache keys that name every input.
6. **Stretch:**
   - Selective purge from the split hashes (a copy-only publish purges just `page:<slug>`).
   - Incremental builds with the Contentful Sync API.
   - Holding back one bad entry at its last valid version instead of blocking every publish.
   - A Contentful app that runs the validator in the editor.

---

## 11. State: server data, Pinia and the URL

| Kind | Example | Where it lives |
|---|---|---|
| Content | catalog, pages | the derived snapshot, via server render and pinned fetches. Not Pinia. |
| Session | draft crew, compare tray, recent saves | Pinia |
| Derived | evaluations, deltas, rankings, suggestions | computed by the engine; never stored |

**Stores:**

- `crewDraft`: positions, objective lens, pins, exclusions, roster filters, name recipe, and the saved crew or preset it came from.
- `compareTray`: up to 4 candidates and the position being compared.
- `session`: ids of crews saved from this browser, kept in localStorage and rendered only in the browser. "Your crews" without accounts.

**The URL is the shareable form:**

- `/build?s=captain.luffy~first-mate.zoro&obj=grand-line&x=blackbeard`
- `/compare?c=robin~brook&s=…&slot=archaeologist`

One serializer in `shared/` writes these URLs on the server and in the browser. Its separators (`.` and `~`) are unreserved characters that `encodeURIComponent`, ufo and Vue Router leave alone, so the canonical form can't drift. *(Found while implementing: `URLSearchParams` form-encodes `~` as `%7E`. Never build these URLs with it, and compare decoded values when deciding whether a URL is canonical, so `%7E` redirects once instead of looping.)* Pinia writes these URLs, and arriving with them fills the store on the server, so the page renders with results.

- *Alternative:* keep the draft in localStorage. It survives closing the tab, but the server can't see it, so server and browser render different pages.
- *Alternative:* no Pinia (URL plus Nuxt's `useState`). Enough for the configurator alone. Pinia earns its place through state shared across pages, devtools and testable actions.

**Hygiene:**

- Stores are created per request and hold only JSON-serializable state.
- Leaving a page cancels any pending URL update.
- Following a link that would replace a non-empty draft asks first.
- Server-side number formatting uses a fixed locale and timezone.

---

## 12. Rendering per page type

| Route | How it renders | Indexed | Why |
|---|---|---|---|
| journeys | server render on CDN miss; purged on publish | yes | SEO and sharing; publishes appear in seconds |
| `/build` | server renders the shell, the catalog and any draft in the URL; interaction (and search, in a Web Worker) runs in the browser | yes (canonical without parameters) | fast first paint; shareable drafts |
| `/crew/[id]` | server render; tagged per crew | no, but full link-preview metadata | link-preview bots need server HTML; user content shouldn't be indexed |
| `/compare?…` | server render from the URL | no | shareable comparisons |
| `/og/crew/[id]` | generated image; content that doesn't drift | — | platforms cache previews for days |
| `/explore` (phase two) | browser only | no | ephemeral AI pages |
| preview deployment | server render from the preview API, uncached | no | editors |

Shareable and indexable are separate decisions: link previews need server HTML, not search indexing.

---

## 13. Phase two: AI as progressive enhancement

### 13.1 Invariants

- **No phase-one page, component, store or build step imports AI code.** The AI lives in `server/assist/`, `/api/assist/*`, a lazily loaded browser-only `/explore`, and a suggestions-panel provider.
- **AI artifacts (catalog digest, schemas) are derived lazily** per `(build, catalogHash)`. Phase one may emit events like `content:promoted`. Phase two may listen, but listeners run in parallel and their errors are caught, so they can never stall or fail a build.
- **No server render calls the model.** Crawlers can't trigger spend, and rendering stays deterministic.
- **The AI can only do what a person can already do by hand.** Its outputs are position assignments, objectives, pins, exclusions, filters, phase-one URLs, or blocks rendered by the same components. That's why roster filters and exclusions are phase-one URL state, and why `complete` takes pins and `improve` exists in phase one.
- **Only the chosen crew is persisted.** Prompts, proposals and generated copy are never stored as product state.
- **The AI can't take phase one down.** On Hobby, usage allowances are shared, so unthrottled AI traffic could pause the whole site.
- **The AI never gates publishing (review).** There is no warm-up call inside the builder. The AI module checks its schema lazily on first use per schema hash. If the API rejects it as too complex, the AI turns itself off and alerts; content still goes live.

### 13.2 The boundary

The interface speaks only our domain types:

- `composePage(text, context) → PageSpec`
- `interpretGoal(text, context) → GoalSpec`

Behind it sit three implementations: Claude, a rule-based matcher (the phase-one text → concept → objective pipeline) and fixtures for tests. A provider-neutral layer around them owns input limits and the deadline, validation, resolving references, running the engine, fallback, and a typed record of the source and any fallback reason.

**Validation lives outside the implementations.** Some providers enforce a schema while generating, some only promise JSON, some promise nothing. Swapping one must never weaken safety.

**Switching models means changing a per-model settings profile, not just a model name.** The models accept different request shapes: Sonnet rejects turning thinking off, Haiku has no server-side refusal fallback, and default efforts differ. So:

- each model has its own request profile;
- a test call runs on every deploy;
- every response records the model, prompt version and catalog hash;
- alerts fire on 4xx errors and on the fallback rate.

**Alternatives:**

- Calling the SDK directly in route handlers. Simpler, but swapping, testing and fallback then all touch the routes.
- Letting the model call the engine as a tool. Several round trips and harder to bound; one model call followed by the engine is deterministic.

### 13.3 Contracts

**What the API guarantees, and what it doesn't:**

- **Enforced while generating:** the model can't invent a block type or an entry key. Capitalization isn't guaranteed, so lookups ignore case, and snapshot validation checks keys are unique regardless of case.
- **Checked afterwards:** lengths, sizes and ranges. That means two schemas: one the API accepts (checked in CI) and a full one for validation.
- **Truncation:** thinking tokens count toward the output limit, so leave headroom and check why the response stopped before parsing.
- **Schema size:** fields stay **required, with an explicit `any` value**, rather than optional or nullable. Every optional or union-typed field counts toward the API's per-schema limits, and a rejected schema would silently send every request to the fallback. *(Review)*
- **Not covered by any schema:** a real key that's the wrong choice. Grounding (below) is the only defense.

**PageSpec (chat):** a title plus 1–6 blocks.

- `hero`: headline, subheadline, optional featured character.
- `featureGrid`: heading plus references to characters, abilities or presets.
- `cta`: heading, label and a target that is a page, a preset, an objective (built through `complete`, never a member list the model picked) or a comparison.
- `testimonial`: a reference to an existing testimonial only. A generated quote attributed to a character would be a fake testimonial.
- The only free text is framing copy, limited to a safe character set.

**GoalSpec (configurator and compare):** 1–3 readings, or "needs clarification", or "not a crew request". Each reading has:

- an authored objective;
- pins: characters that must be included, each with a position or `any`;
- exclusions;
- filters by role, power type, faction or concept, each marked hard or soft, with a position or `any` ("a Marine navigator");
- a `why` of at most 140 characters.

There are no custom weights in v1: the model must not invent the numbers the engine optimizes.

**Checks, in order:**

1. The schema, enforced while generating.
2. Lengths and sizes.
3. Meaning: the crew is valid and uses only active characters.
4. Resolving references through the phase-one adapter.
5. Rendering through the same components, with all text escaped.

Invalid blocks or readings are dropped. If nothing valid remains, the request falls back.

**Grounding over recall.** The catalog digest the model reads includes each character's epithet, aliases, faction, affiliations, Devil Fruit and arcs. "Everyone at Marineford" becomes reading comprehension, not memory.

### 13.4 Chat, and the human as judge

**`/explore`:**

- Rendered only in the browser, marked not to index (meta tag and response header), disallowed in robots.txt and left out of the sitemap.
- Pages are labeled "AI-composed" and kept in sessionStorage so they survive a refresh.
- The server never trusts AI replies sent back by the browser; the browser sends only references and the user's own messages.
- Sharing goes through phase-one URLs, labeled by where they lead ("Share: opens the Crew Builder with these 4").

**Suggestions in the configurator and compare:**

- Shown in their own panel, outside the draft, the URL and the save path, so nothing unaccepted can be shared or saved.
- Each change is a placement ("+Robin → archaeologist") that can be accepted separately and undone.
- A suggestion marks itself stale when the draft changes.
- If every reading lands on the same crew, the panel says "all readings agree".
- The same panel ships in phase one for Auto-fill and Improve, so the AI reuses existing UI.

### 13.5 Degradation, abuse and cost

**Fallback ladder:** AI → typed fallback reason (timeout, rate limit, refusal, invalid output, schema rejected, circuit open) → rule-based matcher → curated "start here" journeys → kill switch.

- The rule-based fallback offers objective chips instead of guessing, and gives up on negation. "No Devil Fruit users" must not keyword-match the Devil Fruit concept and return the opposite crew.

**Deadlines:** SDK retries off (`maxRetries: 0`), one deadline that also fires when the user disconnects, and a circuit breaker so an outage skips the model entirely.

**Abuse:**

- An edge rate limit on `/api/assist/*` (Vercel WAF), so blocked calls never become function invocations.
- Turnstile on submit.
- A daily budget reserved atomically in a Postgres function, refusing AI calls if that store is unreachable.
- A separate Anthropic workspace with its own spend cap.
- **No separate Vercel account in v1 (D16, decided).** The edge rate limit, Turnstile, the daily budget and the kill switch keep AI abuse from using up the shared Hobby allowances. Revisit if the AI route ever trips an allowance.

**Refusals** count as a fallback reason. Dark lore (Magellan's poison, Queen's plagues) is part of the eval.

### 13.6 Model choice

**After the split above, the model's jobs are:**

- pick an authored objective (classification);
- pull out named characters, positions and filters (extraction);
- choose references for a page (selection from facts it's given);
- write a few lines of framing copy.

The engine does the math, validation catches invented keys, and grounding limits wrong picks.

**What decides the model is whether the output can be checked automatically:**

- **GoalSpec → Haiku 5.5 at `medium` effort.** It can be checked automatically against expected objectives, pins and exclusions. Tune effort (`medium` vs `high`) instead of turning thinking off.
- **Chat → Sonnet 5.5 at `low` effort**, because the model writes copy (D5) and copy can't be checked automatically. Prompts are developed top-down against Sonnet, with Opus 5.5 as a ceiling reference; the eval then tries Haiku for chat.
- **No automatic escalation** from Haiku to Sonnet. A wrong-but-valid pick never fails validation, so there's nothing reliable to escalate on.
- **Cost estimate:** roughly a cent per chat turn on Sonnet (a cached ~6K-token prefix, about 1K new input tokens and 600 output tokens). Cost doesn't decide this at sandbox volume.

### 13.7 Eval

- 40–60 requests split into a development set and a held-out set. Mix easy, ambiguous, negation, lore-heavy, multi-constraint, out-of-scope and about five dark-lore cases.
- Answers written in advance and checked by code: expected objective, pins (with positions) and exclusions, expected "needs clarification".
- Copy graded blind, two outputs at a time. Use an AI grader only once it agrees with you at least 90% of the time.
- Compare the rule-based matcher (the AI must beat no AI), Haiku at `medium` and Sonnet at `low`. Run each at least 3 times; track fallback rate by cause and 95th-percentile latency, cold and warm.
- Write the decision rule down before running.
- Offline, a strong model can propose synonyms and concept tags into Contentful for review. AI at authoring time improves the deterministic path for everyone.
- *Rejected:* embeddings for intent matching. They need a second provider, handle negation poorly, and are overkill for about 200 keys.

---

## 14. Review log

### Round 1, phase one

| # | Concern | Verdict |
|---|---|---|
| 1 | The runtime cache couldn't stay consistent on serverless; quota exhaustion would take the site down | Adopted then (content as a build input); D6 now keeps the same guarantees at publish time |
| 2 | Compare delta undefined when the crew is full; pairs invisible; one score hides trade-offs | Adopted (revised again in round 2) |
| 3 | Contextual compare lost its crew when shared | Adopted: crew goes in the URL |
| 4 | A `template`/`kind` field throws away Contentful's validation; rules dropped silently | Adopted for pages; rules → D3 |
| 5 | Separate action entries go live half-published and clutter pickers | Adopted: inline targets |
| 6 | Open tags fed the engine | Adopted: closed lists |
| 7 | Concepts are only word matching | Adopted: `objective` type |
| 8 | Editable keys; unpublishing deletes silently; hash-based drift cries wolf | Adopted |
| 9 | Paused Supabase, IPv6-only connections, cacheable 404s, duplicate saves | Adopted; key-value mirror optional |
| 10 | Preview images blocked under `/api`; changing numbers in cached previews | Adopted |
| 11 | `shared/` rejected on a wrong premise | Adopted (design error) |
| 12 | User-named crews bring moderation | Superseded by D4 |
| 13 | Plain text loses rename-safe links | Adopted: restricted Rich Text (D13) |
| 14 | Cookie preview breaks in Live Preview on Safari | Adopted: separate preview deployment |
| 15 | Make `role` its own content type | Rejected: roles feed the engine, so they belong in code |

### Round 1, phase two

| # | Concern | Verdict |
|---|---|---|
| 1 | AI emitted things phase one couldn't express | Adopted: principle 6; no custom weights |
| 2 | Filling empty slots can't improve a full crew | Adopted: `improve` |
| 3 | No exclusions, hard filters or "not a crew request" | Adopted; lore pick deferred past v1 (D17) |
| 4 | Chat links slipped in model-picked crews; Share misled; refresh lost the chat | Adopted |
| 5 | Suggestions leaked into the draft, URL and saves | Adopted: separate panel |
| 6 | AI schemas generated inside the build; "AI-assisted" column | Adopted |
| 7 | Schema enforcement guarantees less than claimed | Adopted; "turn thinking off" advice rejected |
| 8 | AI abuse could use up shared Hobby allowances | Adopted; no separate account in v1 (D16) |
| 9 | Timeouts didn't bound latency or spend | Adopted |
| 10 | Switching models isn't just config | Adopted: per-model profiles |
| 11 | Free-text filters leak; generated copy next to real quotes; forged history | Adopted |
| 12 | Caches will be cold at this traffic | Adopted then; round 2 moved the warm-up out of the builder |
| 13 | The eval couldn't make the decision | Adopted |
| 14 | Closed key lists turn hallucinations into real-but-wrong picks | Adopted: grounding |
| 15 | Low effort or thinking off is outside Haiku's documented range | Adopted |
| 16 | Evaluate top-down; chat copy is the uncheckable route | Adopted; with D5, chat starts on Sonnet |
| 17 | Refusal fallback doesn't distinguish the models | Adopted: dark-lore cases |

### Round 2, runtime caching

| # | Concern | Verdict |
|---|---|---|
| 1 | A snapshot depends on code as well as content; one global derived snapshot breaks deploys and rollbacks | Adopted: raw snapshots behind one pointer; each deployment derives and validates its own view, keyed by (build, hash) |
| 2 | Nitro's `event.waitUntil` doesn't keep work alive on Vercel; the build would freeze holding the lease | Adopted: build synchronously in the webhook; 503 when busy so Contentful's retries re-kick; no self-kick |
| 3 | Compare-and-swap isn't fencing; the delivery API can lag the webhook; the HTTPS client can't express lease updates | Adopted: fenced `promote`, revision check with backoff, Postgres functions |
| 4 | An in-flight render can re-cache old HTML after a purge; several pointer reads can mix versions; purges can fail | Adopted: one pointer read per request, purge after the longest render, recorded retries, 1-hour backstop |
| 5 | Stale-while-revalidate misleads at sandbox traffic; the seed fallback can overwrite good cached pages | Adopted: delete on promotion; 503 when the pointer is unreachable |
| 6 | "Immutable" API responses weren't CDN-cached; snapshots in `jsonb` | Adopted: CDN header; raw snapshot bytes in Vercel Blob |
| 7 | A 409 on save fights the recipe model | Adopted: 422 only for invalid choices; split catalog and pages hashes |
| 8 | Hard to debug on Hobby (1-hour logs, silent no-ops, stripped tag header) | Adopted: build log, debug headers, canary |
| 9 | Supabase is right for the pointer, wrong for blobs; Edge Config unsuitable | Adopted: pointer timeout and circuit breaker; colocated regions |
| 10 | An AI warm-up hook could stall or fail a build | Adopted: no warm-up in the builder; lazy schema check |
| 11 | Reload loops, retention, untagged 404s, tracking parameters, cookies, raw-body signatures, robots | Adopted |
| — | Cut from v1: Runtime Cache, self-kick, pointer polling, 409, selective purge, per-entry hold-back | Adopted: moved to the ladder |

### Round 2, positions, rules and names

| # | Concern | Verdict |
|---|---|---|
| 1 | Ten canonical positions and summed stats work against a fighter-heavy roster | Adopted: owned stats, shared combat, one fit pair, builder warnings; the position list was your call: 12, decided 2026-10-14 |
| 2 | The non-dominated view shows everything; "best placement" hides a score | Adopted: compare within one position; no ranking without a lens; pairs from a rule index |
| 3 | Rules in Contentful are premature while their semantics churn | Adopted: code for v1, decided 2026-10-14 |
| 4 | With rules in Contentful, one bad rule freezes all publishing | Partly adopted: rules in code remove the main source; v1 stays strict with loud feedback; hold-back and an in-editor validator are ladder levels. The caching skeptic argued to cut hold-back; strict for v1, decided 2026-10-14 |
| 5 | Five flat kinds miss common synergies; faction changes over time | Adopted: composable conditions and several effects; faction = current canon affiliation |
| 6 | Effect scope undefined; negative and overflow cases | Adopted: add and cap with declared scope; clamp at zero; percentages later as additive points |
| 7 | Search results would feel arbitrary | Adopted: greedy with reasons, rule index, leave-one-out explanations, Web Worker |
| 8 | Word combinations can form slurs; identical epithet names; list items have no keys | Adopted: no character names, combination deny-list, text keys, stored recipe, user names never in previews |
| 9 | Optional position fields in GoalSpec eat schema limits | Adopted: required fields with `any`; `complete` takes pins, exclusions and pools |
| 10 | 301 canonical redirects can loop | Adopted: 307, CDN-only caching, one serializer with unescaped separators |

---

## 15. Open questions

None. All were settled on 2026-10-14: D3 rules in code for v1; D2 twelve positions at 100/50; D4 generated names only for v1; D13 restricted Rich Text (entry links only); strict publishing in v1; D16 no separate account for the AI route; D17 lore pick deferred past v1.

---

## 16. Sources

- Contentful:
  - [usage limits](https://www.contentful.com/help/admin/usage/usage-limit/)
  - [usage limits (Jan 2026)](https://www.contentful.com/help/usage-limits-january-2026/)
  - [technical limits](https://www.contentful.com/developers/docs/technical-limits-2025/)
  - [available validations](https://www.contentful.com/help/fields/available-validations/)
  - [content types API (validations)](https://www.contentful.com/developers/docs/references/content-management-api/content-types/)
  - [webhooks overview](https://www.contentful.com/developers/docs/extensibility/webhooks/)
  - [webhook request verification](https://www.contentful.com/developers/docs/webhooks/request-verification/)
  - [App Framework SDK](https://www.contentful.com/developers/docs/extensibility/app-framework/sdk/)
- Supabase:
  - [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
  - [table exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
  - [IPv4 and direct connections](https://supabase.com/docs/guides/platform/ipv4-address)
  - [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html)
- Vercel plan and functions:
  - [Hobby plan](https://vercel.com/docs/plans/hobby)
  - [limits](https://vercel.com/docs/limits)
  - [function limits](https://vercel.com/docs/functions/limitations)
  - [`@vercel/functions` reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
  - [Skew Protection](https://vercel.com/docs/skew-protection)
  - [Instant Rollback](https://vercel.com/docs/instant-rollback)
  - [WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
  - [cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- Vercel caching and storage:
  - [CDN cache purge and tags](https://vercel.com/docs/caching/cdn-cache/purge)
  - [tag-based invalidation for all responses](https://vercel.com/changelog/tag-based-cache-invalidation-now-available-for-all-responses)
  - [Cache-Control headers](https://vercel.com/docs/headers/cache-control-headers)
  - [Runtime Cache](https://vercel.com/docs/caching/runtime-cache)
  - [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- Nuxt and Nitro:
  - [prerendering and route rules](https://nuxt.com/docs/4.x/getting-started/prerendering)
  - [`shared/` directory](https://nuxt.com/docs/4.x/directory-structure/shared)
  - [experimental features (payload extraction)](https://nuxt.com/docs/4.x/guide/going-further/experimental-features)
  - [Nuxt 4.3 release](https://nuxt.com/blog/v4-3)
  - [Nuxt 4.4 release](https://nuxt.com/blog/v4-4)
  - [CVE-2026-71316](https://advisories.gitlab.com/npm/nuxt/CVE-2026-71316/)
  - [Nitro cache](https://nitro.build/docs/cache)
  - [Nitro on Vercel](https://nitro.build/deploy/providers/vercel)
- HTTP: [RFC 9110 (redirect caching)](https://www.rfc-editor.org/rfc/rfc9110)
- Anthropic:
  - [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
  - [refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)
  - [TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)
