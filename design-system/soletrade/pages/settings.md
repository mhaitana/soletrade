# Page Override - Settings

**Overrides:** This file overrides `design-system/soletrade/MASTER.md` for `/settings/*` (General, Account, Modules, Members, Billing-as-settings).

## Layout
- Left sidebar nav (`md:w-52`) of section links, content on the right. On mobile the nav stacks above content.
- Active section: `bg-muted text-foreground`; inactive: `text-muted-foreground hover:bg-muted/60`.
- Each section renders form(s) inside `Card` sections (CardHeader/CardTitle/CardDescription/CardContent) - flat hairline, no shadow.

## Forms
- Use shared `<Input>`, `<Label>`, `<Button>` primitives. Native `<select>` retargeted to warm tokens (`border-input`, `ring-ring/40` focus) until a `Select` primitive exists.
- Destructive actions (cancel subscription, remove member, delete) use `variant="destructive"` and are visually separated (destructive-emphasis + destructive-nav-separation rules).
- Save/cancel row at the foot of each form; disable Save while submitting; confirm before navigating away with unsaved changes (sheet-dismiss-confirm).

## Color & type
- Background `bg-background`, cards `bg-card` + `border border-border` (no shadow). Primary Save = `bg-primary` (ink).
- Invoice/quote number-prefix previews render `font-mono` (they're identifiers). Counts use Inter `tabular-nums`.

## Accessibility
- `aria-current="page"` on the active settings nav item.
- Form labels visible; helper text below complex fields; errors near fields with `role="alert"`.
- Member role changes and destructive actions confirmed via dialog.