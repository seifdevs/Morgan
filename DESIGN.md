---
name: Morgan
description: A dark financial ledger where gold marks what is recorded and dashes mark what is estimated.
colors:
  ink-night: "#0b0f14"
  surface: "#121820"
  raised: "#19212b"
  sunken: "#0d1218"
  paper-white: "#f4f6f8"
  pewter-soft: "#b9c1c7"
  slate-muted: "#8d98a5"
  rule-line: "#27313c"
  rule-line-soft: "#1d252f"
  ledger-gold: "#c9a86a"
  ledger-gold-hi: "#dbbc82"
  ledger-gold-dim: "#a28757"
  settled-green: "#2f9b70"
  caution-amber: "#d6a84f"
  overdue-red: "#c65d5d"
typography:
  display:
    fontFamily: "Manrope, DM Sans, sans-serif"
    fontSize: "clamp(48px, 7.4vw, 112px)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.055em"
  headline:
    fontFamily: "Manrope, DM Sans, sans-serif"
    fontSize: "clamp(32px, 4vw, 54px)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Manrope, DM Sans, sans-serif"
    fontSize: "clamp(26px, 3vw, 34px)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  figure:
    fontFamily: "Manrope, DM Sans, sans-serif"
    fontSize: "clamp(20px, 2.1vw, 28px)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.03em"
    fontFeature: "'tnum'"
  accent:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontWeight: 400
    letterSpacing: "-0.01em"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "'ss01'"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.06em"
    fontFeature: "'zero'"
  eyebrow:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  gutter: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ledger-gold}"
    textColor: "{colors.ink-night}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.ledger-gold-hi}"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-ghost:
    textColor: "{colors.pewter-soft}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "42px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "18px 20px 20px"
  badge:
    rounded: "{rounded.xs}"
    padding: "0 9px"
    height: "24px"
  nav-item-active:
    textColor: "{colors.paper-white}"
    padding: "9px 10px"
---

# Design System: Morgan

## Overview

**Creative North Star: "The Night Ledger"**

Morgan is a bound ledger read by lamplight. The paper is near-black blue-slate, the lines are ruled thin, and gold ink marks what has actually been recorded. Anything Morgan has not recorded (projections, run-rates, what-ifs) is drawn in pencil dashes, never in ink. The whole system follows from that one distinction, which is also a public product promise: a recorded figure and an estimate never look the same.

Two densities share one material. The public site reads like an editorial folio: a 12-column grid, very large tight Manrope headlines, an italic Instrument Serif turn of phrase for emphasis, numbered mono folio labels in the margin, and generous vertical spacing. The app is a working ledger: a 248px sidebar, compact panels, tabular figures, hairline-ruled tables and lists. Both stay dark (`color-scheme: dark`); there is no light theme.

Components are quiet and exact. Panels sit only slightly above the page, rules are hairlines, and corners barely round. Gold is rationed to the primary action, focus, active navigation, recorded data and folio labels. Motion acknowledges input (a small press, a sliding underline, a gold tick on row hover) and never hides content. The public site has one authored moment, the hero's ink-and-pencil sequence; everything else is feedback or state change.

**Key Characteristics:**
- Near-black slate surfaces separated by tone and 1px rules, not by heavy shadows.
- Ledger Gold as the single accent, meaning "recorded / act here / you are here".
- Solid lines for recorded figures, dashed lines for estimates, in every chart, legend and badge.
- Manrope for headings and figures, DM Sans for running text, JetBrains Mono for folio labels, Instrument Serif italic for emphasis phrases only.
- Tabular numerals on every amount.
- Small radii (3–8px) and hairline borders; editorial structure from rules and numbering.

## Colors

The palette is cool slate darks with one warm metal accent and three muted status hues.

### Primary
- **Ledger Gold** (ledger-gold): The ink of record. Used for the primary button, focus outlines, the active sidebar marker, recorded chart lines and income bars, folio labels, links, the wordmark's "mor", and the receivables/breakdown fills.
- **Lit Gold** (ledger-gold-hi): The hover and highlight state of Ledger Gold: primary button hover, highlighted bars, link hover, the top of the story-rail gradient.
- **Tarnished Gold** (ledger-gold-dim): Recessive gold for gradient tails, major tick marks on rule strips, and the founder-section rule.

### Secondary
- **Settled Green** (settled-green): Paid, positive deltas, success toasts, password rules met.
- **Caution Amber** (caution-amber): Partial and unpaid states that need attention but aren't late yet.
- **Overdue Red** (overdue-red): Overdue badges, negative deltas, errors and destructive actions. Text on dark uses lighter tints (#ec8f8f, #ef9a9a) for contrast.

Status badges use the hue as text over a tint of about 8% with a border of about 25% (for example, paid = #5fc79a on #2f9b7018 with a #2f9b7040 border). "Sent" uses a muted steel blue (#9ec3e6 on #5b8cbf18), its one appearance in the system.

### Neutral
- **Ink Night** (ink-night): Page background and `theme-color`.
- **Surface** (surface): Panels, modals, plan cards.
- **Raised** (raised): Secondary buttons, the selected segmented-control option, count pills.
- **Sunken** (sunken): Inputs, segmented-control tracks, chart bar tracks. Inputs sit *below* the surface.
- **Paper White** (paper-white): Primary text and headings.
- **Pewter Soft** (pewter-soft): Secondary emphasised text, ghost buttons, list items, the estimate line in charts.
- **Slate Muted** (slate-muted): Descriptions, labels, table headers, axis-adjacent copy.
- **Rule Line** (rule-line): Panel borders, table header rules, section dividers.
- **Rule Line Soft** (rule-line-soft): Row dividers, inner panel splits, modal footers.

The sidebar and auth stage go one step darker than the page (#0a0e13), and the footer goes darker again (#080b0f).

### Named Rules
**The Ink and Pencil Rule.** Recorded data is drawn solid, usually in Ledger Gold. Estimated data is drawn dashed, usually in Pewter Soft. Legends use `.dashed` swatches, and the `estimate` badge has a dashed dot. Never draw an estimate solid, and never draw a recorded series dashed.

**The Rationed Gold Rule.** Gold means one of three things: this is recorded, act here, or you are here. Don't use it for decoration that means none of those. A screen with gold on more than a handful of elements has lost its signal.

## Typography

**Display Font:** Manrope (with DM Sans, sans-serif)
**Body Font:** DM Sans (with system-ui), stylistic set `ss01` on
**Label/Mono Font:** JetBrains Mono (with ui-monospace, Menlo), slashed zero on
**Accent Font:** Instrument Serif italic (with Georgia)

**Character:** Manrope is set heavy and very tight, which gives headings the weight of a bound title page. DM Sans keeps running text plain and legible. The mono folio labels give the margins of a ledger, and a single Instrument Serif italic phrase in a heading adds the human, handwritten note.

### Hierarchy
- **Display** (800, clamp(48px, 7.4vw, 112px), 0.92, −0.055em): Home hero only. Inner-page mastheads use the same voice slightly smaller (800, clamp(42px, 6.4vw, 96px), 0.95).
- **Headline** (700, clamp(32px, 4vw, 54px), 1.04, −0.04em): Public section headings.
- **Title** (700, clamp(26px, 3vw, 34px), 1.1, −0.035em): App page headers. Panel heads drop to 650 at 15px.
- **Figure** (700, clamp(20px, 2.1vw, 28px), tabular): KPI values. The hero KPI goes up to clamp(26px, 2.8vw, 38px). Table amounts use Manrope 650 with tabular numerals, right-aligned.
- **Body** (400, 15px, 1.55): Running text. Leads go to 18px/1.65 in Slate Muted with a max width of 520px. Long-form guide and FAQ text uses 1.75 line height.
- **Label** (500, 11px, 0.06em, uppercase mono): Folio labels ("N°03 Cash flow"), footer column heads, guide numbers, signup steps.
- **Eyebrow** (600, 11px, 0.12–0.16em, uppercase sans): Table headers, sidebar group labels, eyebrows.

### Named Rules
**The One Italic Rule.** Instrument Serif appears only as an italic phrase inside a Manrope heading ("Own your *numbers.*"), at most once per heading, often in gold. It is never used for body text, labels or a full heading. The login stage headline is the single exception.

**The Tabular Figures Rule.** Every amount, count, date in a table and KPI uses tabular numerals (`.num`, `.mono` or `tnum`), so columns of money line up to the cent.

## Layout

The public site uses a 12-column grid with 24px column gaps inside a 1320px container, with side gutters of clamp(20px, 4vw, 56px). Compositions are deliberately asymmetric: copy anchored on columns 1–5, art on 6–13, art bleeding past the container edge, and sticky section headers on the left of long lists. Sections are separated by large viewport-relative spacing (clamp(80–120px, 14–18vh, 160–200px)) and by full-width 1px rules. The ruled-paper background (a 1px line every 40px) appears on selected bands.

The app is a two-column shell: a sticky 248px sidebar and a main area capped at 1440px, padded 32px clamp(16px, 3vw, 44px) 80px. Pages open with a header row (title and description on the left, controls on the right) and then a KPI statement strip: one joined panel with a wider hero cell (1.35fr) and four equal cells split by soft rules. Content grids are `cols-2` or `main-side` (1.7fr to a minimum 300px side column).

Spacing inside components is on an approximately 4px rhythm: 8, 12, 16, 20 and 24px.

Breakpoints: at 1100px the public grids collapse to a single stacked column; at 760px fact rows and two-column lists stack; at 640px form grids go single-column, toasts span the width, and modals become bottom sheets with only the top corners rounded.

## Elevation & Depth

Depth comes mostly from tone, with one soft lift. Surfaces step from Ink Night to Surface to Raised, with Sunken below for inputs and tracks. Each panel carries a single shadow: a 1px inner top highlight plus a long, dark, low-opacity drop. That reads as a sheet lying on the desk, not floating above it. Larger shadows are reserved for things that truly sit above the page: modals, toasts and chart tooltips. Sticky bars (public nav when scrolled, the module nav) use a translucent Ink Night with a backdrop blur instead of a shadow.

### Shadow Vocabulary
- **Sheet** (`box-shadow: 0 1px 0 #ffffff08 inset, 0 24px 60px -24px #000a`): Every panel and the KPI strip.
- **Gilt glow** (`box-shadow: 0 1px 0 #fff4 inset, 0 8px 24px -10px #c9a86a88`): The primary button only.
- **Float** (`box-shadow: 0 20px 50px -10px #000c`): Toasts. Tooltips use a lighter version, and modals a deeper one (`0 40px 120px -20px #000`).
- **Focus halo** (`box-shadow: 0 0 0 3px #c9a86a22`): Focused inputs, together with a Ledger Gold border.

### Named Rules
**The Sheet, Not Card Rule.** Panels are sheets on a desk: one inner highlight plus one long soft drop. Don't stack shadows, add colored glows, or lift panels on hover. Only the primary button glows, and only in gold.

## Shapes

The form language is ruled and nearly square. Radii stay small: 3px for badges and count pills, 4px small, 6px for buttons, inputs and toasts, and 8px for panels and modals. Some public editorial elements (plan cards, module icons, the founder panel, contact panel) have no radius at all, so the ledger's ruled lines read as structure. Hairline 1px borders define everything. A 2px Ledger Gold left or top border marks the one featured item in a group (the cash-flow callout, the Professional plan, the contact panel). Circles appear only as status dots inside badges.

## Components

### Buttons
Quiet and exact, with a small physical press.
- **Shape:** gently squared (6px), 40px tall by default; 32px small and 48px large.
- **Primary:** a vertical gradient from Lit Gold to Ledger Gold, Ink-dark text (#101316), weight 600 at 14px, with the gilt glow. On hover it goes solid Lit Gold and the glow deepens slightly; nothing sweeps or lifts.
- **Secondary (default):** Raised fill, Rule Line border, Paper White text. Hover lightens the fill (#1e2833) and the border (#3a4652).
- **Ghost:** transparent, Pewter Soft text; hover adds a faint white wash (#ffffff08).
- **Danger:** transparent, light red text (#e58c8c), red border at about 33%; hover tints red.
- **Motion:** CSS owns all button motion (never Motion props, so nothing competes). Hover changes colour only; press sets the button down 1px at 0.985 scale in 50ms, no spring overshoot; focus is a 2px gold ring at 2px offset with no transition; a busy button shows a 14px spinner and `cursor: progress` without changing width. A trailing ↗ arrow nudges 2px on hover. Disabled is 55% opacity with no press.

### Badges (status chips)
- **Style:** 24px tall, 3px radius, 12px weight 600, with a 6px status dot in the current color. Each status is its hue as text over a roughly 8% tint, with a roughly 25% border.
- **States:** draft (Pewter), sent (steel blue), partial and unpaid (Amber), paid (Green), overdue (Red), void (muted and struck through), estimate (Gold with a *dashed* hollow dot).

### Panels / Containers
- **Corner Style:** 8px.
- **Background:** Surface.
- **Shadow Strategy:** the Sheet shadow (see Elevation & Depth).
- **Border:** 1px Rule Line.
- **Internal Padding:** the head is 18px 20px 0, the body 18px 20px 20px; panel titles are Manrope 650 at 15px.

### Inputs / Fields
- **Style:** Sunken fill, 1px Rule Line border, 6px radius, minimum height 42px, padding 10px 12px. Labels sit above in 12.5px weight 600 (#cbd1d7), hints below in 12px Slate Muted. Number inputs align right.
- **Focus:** Ledger Gold border plus the 3px gold halo, and the fill darkens slightly (#0f151c).
- **Error / Disabled:** `aria-invalid` turns the border Overdue Red. Form errors are a red-tinted box with a light red message.

### Navigation
- **Public (masthead):** a three-part bar: links on the left, the wordmark centred, Log in and Get started on the right. Transparent over the hero; once scrolled (or with the menu open) it turns solid Ink Night with a hairline. A single gold underline (`<Marker>`) glides between the hovered or active link. The bottom rule is the reading-progress line: ink up to TODAY, pencil after. Below 860px the links fold into a two-line toggle that morphs into an X and opens a full-height sheet revealed by a clip-path curtain, with links staggered in; page scroll locks and Escape closes it.
- **App sidebar:** darker than the page (#0a0e13), with the business tile at the top and uppercase eyebrow group labels. Items are 14px Slate Muted with an icon. Hover adds a faint wash. The active item turns Paper White on a gold wash (#c9a86a12), its icon turns gold, and a 3px gold bar sits on the sidebar edge.
- **Tabs:** Slate Muted weight 600 labels; the selected tab is Paper White with a 2px gold underline.

### Tables
Hairline-ruled ledgers. Headers are 11px uppercase eyebrows in Slate Muted over a Rule Line; rows are divided by Rule Line Soft with 13px 16px cells. Amounts use tabular Manrope 650 and are right-aligned. On hover a row gets a faint wash, and a 2px **gold ledger tick** slides in on its first cell. Totals sit in a bold footer over a full rule.

### KPI Statement Strip (signature)
A single joined panel reading like the top line of a statement: a wider hero cell with a faint gold radial wash, followed by four equal cells split by soft vertical rules. Each cell has a muted label, a Manrope figure, an optional 30px sparkline, and a footer for the delta or an estimate note.

### Folio Label (signature)
The marginal voice of the system: a gold rule, then mono uppercase text in gold ("N°03"), followed by a muted bold section name. On public sections and inner-page mastheads it is a **margin note** (`.folio.mnote`): set vertically in the left margin beside the copy, and below 1100px a quiet line *under* the heading. It is never a kicker above a heading.

### Home: "scroll is time" (signature)
The homepage's vertical axis is time. The hero ends on a time axis (solid gold rule → TODAY → pencil dashes). Sections above the money-flow statement carry solid hairline rules (ink: what Morgan records); sections after it carry dashed rules (pencil: principle, *proposed* pricing, what comes next). The money-flow statement (`MoneyFlow`) is the centrepiece: eight sample weeks as an ink waterfall (money in up in gold, money out down in slate, closing balances joined by a line) that becomes hatched, dashed pencil after TODAY. On screens at least 1100×780 it pins and the visitor scrubs it by scrolling, with four narrative steps lighting in turn; every week is a button that opens its entries. Unposted weeks stay visible as faint outlines. Smaller screens and reduced motion get the full statement, unpinned.

### Scrolling
`ScrollManager` owns scroll position (there is no global `scroll-behavior: smooth`): in-page anchors scroll smoothly (instantly under reduced motion) below the sticky nav via `scroll-padding-top`/`scroll-margin-top`, join browser history and move focus to the target; new pages start at the top; Back/Forward restore position; cross-page `#hash` links land after lazy content renders. A 1.5px gold reading-progress hairline sits under the public nav.

### Motion (Motion for React + CSS)
- **Focal moment:** the Ledger Line hero. A full-bleed sixteen-week cash line splits the headline ("Know your business." above, "Own your numbers." in serif below). The recorded line inks in gold behind a clip edge, the TODAY rule carries the recorded figure, and the estimate is pencilled in dashes after it. Posted entries tick past the line; on fine pointers a crosshair reads any week. On scroll the band flattens into the gold rule that opens the next section. Reduced motion renders the end state with no ticker.
- **Proof pieces:** the audit trail draws Morgan's cost flags as margin brackets with their evidence beside them; the principle draws one ink stroke then one pencil stroke as you scroll.
- **Continuity:** one shared-layout marker per selection group (`<Marker>`, Motion `layoutId`): the sidebar's gold wash and edge bar, tab underlines, segmented-control fills glide to the new selection.
- **Feedback:** toasts spring in and exit faster than they enter; figures show their value at once and spring only when it changes (no count-up on every visit); route changes cross-fade in 180ms.
- **Budget:** Motion loads via `LazyMotion` with features fetched after first paint; looping illustrations pause offscreen; `MotionConfig reducedMotion="user"` everywhere.

## Do's and Don'ts

### Do:
- **Do** draw recorded series solid in Ledger Gold and estimates dashed in Pewter Soft, and label estimates with the `estimate` badge or a chart note.
- **Do** set every amount in tabular numerals, right-aligned in tables.
- **Do** separate regions with 1px Rule Line / Rule Line Soft and tone steps before adding any shadow.
- **Do** keep radii between 3 and 8px: 6px for controls, 8px for panels.
- **Do** mark the single featured item in a group with a 2px gold left or top border.
- **Do** use one Instrument Serif italic phrase per heading for emphasis, at most.
- **Do** start every element visible by default, keep one authored moment per surface, and honor `prefers-reduced-motion`.
- **Do** keep toasts bottom-left; the Helix chat widget owns the bottom-right.

### Don't:
- **Don't** draw an estimate solid or a recorded figure dashed.
- **Don't** spend gold on decoration that doesn't mean recorded, act here, or you are here.
- **Don't** add a light theme or light panels; the ledger is dark.
- **Don't** introduce new radii (the stray 7px, 9px and 10px values in segmented buttons, sidebar items and the business monogram are drift, not vocabulary).
- **Don't** stack shadows, add colored glows other than the primary button's gold, or lift panels on hover.
- **Don't** set body text, labels or a full heading in Instrument Serif.
- **Don't** hide content behind an animation that might not run, or repeat the same entrance on every section.
- **Don't** put an eyebrow or folio label above a heading; folios live in the margin.
- **Don't** use text glyphs (↑ ↓ ○ ●) as icons; draw them.
