# Page Override — Auth & Onboarding

**Overrides:** This file overrides `design-system/soletrade/MASTER.md` for `/login`, `/signup`, `/auth/callback`, `/onboarding`, and `/invite/[token]`.

## Core principles
- Centered, single narrow column (`max-w-sm` auth cards, `max-w-md` onboarding) on `min-h-dvh`.
- Card container: `rounded-lg border border-border bg-card p-8` — **no shadow** (flat hairline, paper-like).
- Trust through restraint: whitespace, clear hierarchy, one primary CTA. No decorative color.
- Onboarding has **no card** — full-width centered form (it's a flow, not a wall).

## Layout
- Centered Logo (link to landing) → h1 → optional subtitle → form → secondary link (e.g. "Already have an account? Sign in").
- Forms are bare (no Card wrapping the form fields on `new` pages inside the app); auth pages wrap the whole card.

## Forms & feedback
- Inputs use the shared `<Input>` (hairline, blue focus ring). Labels visible (not placeholder-only).
- Password field: show/hide toggle (password-toggle rule). `autocomplete` + `type` set for autofill.
- Submit: loading state (spinner + disabled), inline error below the relevant field, `aria-live` for screen readers.
- Magic-link and OAuth: clear primary/secondary separation; one primary CTA per screen.

## Color & type
- Background `bg-background`, card `bg-card`, border `border-border`. Primary CTA `bg-primary` (ink). Links `text-brand-blue`.
- Inter throughout; no mono numerics on auth (no amounts). Onboarding step counts may use Inter tabular-nums.

## Accessibility
- Skip link not needed (single screen). Focus ring visible; tab order top→bottom.
- Error messages: cause + how to fix, near the field, `role="alert"`.
- Confirm destructive/account actions (e.g. leave flow) with an explicit dialog.