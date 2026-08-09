# Mobile signup flow design

Status: Approved direction, ready for implementation planning

Date: 2026-08-09

## Goal

Give phone and tablet users a focused signup flow that combines account creation, module selection, billing choice, and promotional-link handling without horizontal scrolling or a distant primary action.

Desktop users keep the current side-by-side account and module layout. Screens below the `lg` breakpoint use two stages inside the same form:

1. Account
2. Tools & price

Both stages share the current signup state and submit through the existing authentication actions.

## Audit findings

The 390px audit found these issues:

- The signup document expands to 456px and clips controls on a 390px viewport.
- Selecting annual billing can move the page to `scrollX = 44.5`.
- The primary signup action starts about 1,450px below the top of an 844px viewport.
- Billing controls measure 40px high, below the 44px mobile target.
- The workspace-name input receives focus on load, which can open a mobile keyboard before users review their selected setup.

The module cards, promotion messaging, email confirmation, and workspace summary already provide clear content and will retain their current visual language.

## Responsive behaviour

### Below `lg`

The form starts on the Account stage. A compact ordered progress list identifies both stages and marks the current item with `aria-current="step"`. The page shows one stage at a time while keeping both stage trees mounted, so browser-managed input values survive stage changes.

The Account stage contains:

- full name, email, password, and confirmation fields in password mode;
- email and the current explanation in magic-link mode;
- the password or magic-link switch;
- the existing sign-in link;
- a full-width `Choose your tools` button.

The Tools & price stage contains:

- a Back control that returns to Account;
- module cards and the selected count;
- monthly and annual billing controls;
- applied or unavailable promotion feedback;
- estimated price and savings;
- the final signup action, legal copy, and checkout reassurance.

The transition moves focus to the destination heading and scrolls the signup card to its top. Screen-reader users receive the new stage name through the progress header. The Back control preserves all account values, module selections, the billing interval, and the promotional code.

### At `lg` and above

The form shows the account section and module sidebar together. Mobile stage controls stay hidden. Existing desktop spacing and the two-column structure remain in place.

Resizing from mobile to desktop reveals both sections. Resizing back to mobile restores the last active mobile stage.

## Layout changes

The signup grid, account section, and module sidebar receive explicit `min-width: 0` constraints. Flexible rows wrap content instead of increasing the document width.

Module descriptions wrap to two lines where needed. Prices and selection indicators keep a stable trailing position without forcing the label outside the viewport. Billing buttons use a minimum height of 44px. The account-mode and sign-in row can stack at narrow widths.

The mobile page header uses less vertical padding and shorter supporting copy. The email-confirmation state keeps its current content and receives the same width safeguards.

Workspace onboarding keeps its existing one-screen structure. The form no longer focuses the workspace-name input on load, which leaves the full summary and primary action visible until the user taps the field.

## State and data flow

`SignupForm` adds a local `mobileStep` state with `account` and `modules` values. Existing state continues to own the authentication mode, selected module keys, billing interval, submission status, and email-confirmation state.

The Account continue control performs browser constraint validation against the account fields. Password mode also compares the password and confirmation values before the form advances. This check does not call the server.

The final action submits through the current `signUpAction` or `signInWithOtpAction`. Signup intent construction remains unchanged and carries the selected module keys, billing interval, and validated promotion code.

Server field errors return mobile users to Account, focus a `tabIndex={-1}` error summary, and keep their selections. A zero-module state remains on Tools & price and disables final submission. Promotion failures stay beside pricing. Successful submissions continue to use the existing redirect or check-email behaviour.

No database, Stripe, promotion, checkout, or authentication API changes are part of this work.

## Accessibility

- Interactive controls provide at least a 44px touch target on mobile.
- Stage headings receive programmatic focus after a stage change.
- Progress text exposes the current stage without relying on colour.
- Hidden mobile stages do not remain in the accessibility tree.
- Error messages retain `role="alert"` and connect to their fields through `aria-describedby`.
- Module checkboxes keep their current label-based accessible names.
- The layout supports 320px reflow without horizontal scrolling.

## Test strategy

Implementation follows test-driven development.

Component tests will cover:

- the Account stage as the mobile starting state;
- account validation before stage advancement;
- password mismatch feedback;
- account values and signup intent surviving Back and Continue;
- magic-link mode through both stages;
- server field errors returning users to Account;
- zero-module prevention and promotion feedback.

Browser verification will cover 320x568, 390x844, 768x1024, and a desktop viewport. Checks will confirm:

- `scrollWidth` does not exceed `clientWidth`;
- the correct stage appears at each mobile step;
- keyboard navigation and focus movement work;
- touch targets meet 44px;
- module, interval, and promotional state survive stage changes;
- desktop still displays both sections;
- check-email and onboarding screens reflow without clipping.

The final verification also runs the focused unit tests, TypeScript, ESLint, formatting checks, and a production build.

## Acceptance criteria

- Users on phone and tablet widths complete Account and Tools & price as two stages of one signup form.
- Users can move between stages without losing entered or selected data.
- Password and magic-link signup submit the same payloads used today.
- Promotional links remain applied through signup, verification, onboarding, and checkout.
- A 320px viewport has no horizontal document scroll.
- Mobile signup and billing controls meet the 44px touch-target requirement.
- Desktop signup keeps its two-column flow.
- Workspace onboarding does not open the software keyboard on page load.
