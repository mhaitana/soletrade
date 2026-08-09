# Mobile Signup Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overflowing mobile signup page with a two-stage Account → Tools & price flow while preserving the existing desktop layout and signup payloads.

**Architecture:** `SignupForm` remains one React client form backed by the current Server Actions. Local stage state controls which section CSS displays below `lg`; both sections render together at desktop widths. Existing module, billing, promotion, and authentication state remains in the form, while focused component tests cover transitions and the in-app browser verifies responsive layout.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Vitest, Testing Library, in-app Browser verification

## Global Constraints

- Screens below `lg` use Account and Tools & price stages inside one form.
- Screens at `lg` and above retain the two-column account and module layout.
- Password and magic-link signup keep the current Server Action payloads.
- Promotional codes remain attached to the existing signup intent.
- A 320px viewport must not gain horizontal document scroll.
- Mobile signup and billing controls provide at least 44px touch targets.
- Workspace onboarding must not focus the name field on page load.
- Do not change database, Stripe, checkout, promotion, or authentication APIs.
- Follow the local Next.js 16 documentation in `node_modules/next/dist/docs/`.

---

### Task 1: Add the mobile stage shell

**Files:**

- Create: `src/app/(auth)/signup/signup-form.test.tsx`
- Modify: `src/app/(auth)/signup/signup-form.tsx:1-430`

**Interfaces:**

- Consumes: existing `SignupForm` props and the current `signUpAction` / `signInWithOtpAction` calls.
- Produces: `type MobileStep = "account" | "modules"`, a mobile progress list, `Choose your tools`, and `Back to account` controls.

- [ ] **Step 1: Write the failing stage-transition test**

Create the test harness with stable navigation and auth-action mocks:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "./signup-form";

const { push, signUpAction, signInWithOtpAction } = vi.hoisted(() => ({
  push: vi.fn(),
  signUpAction: vi.fn(),
  signInWithOtpAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/app/(auth)/actions", () => ({
  signUpAction: (...args: unknown[]) => signUpAction(...args),
  signInWithOtpAction: (...args: unknown[]) => signInWithOtpAction(...args),
}));

function renderSignup() {
  return render(
    <SignupForm intent={{ moduleKeys: ["books"], interval: "monthly" }} />,
  );
}

async function fillPasswordAccount(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Full name"), "Jane Smith");
  await user.type(screen.getByLabelText("Work email"), "jane@example.com");
  await user.type(screen.getByLabelText("Password", { selector: "input" }), "password123");
  await user.type(
    screen.getByLabelText("Confirm password", { selector: "input" }),
    "password123",
  );
}

describe("SignupForm mobile stages", () => {
  beforeEach(() => {
    push.mockReset();
    signUpAction.mockReset();
    signInWithOtpAction.mockReset();
  });

  it("advances from Account to Tools & price after valid account input", async () => {
    const user = userEvent.setup();
    renderSignup();

    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Account");
    await fillPasswordAccount(user);
    await user.click(screen.getByRole("button", { name: "Choose your tools" }));

    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(
      "Tools & price",
    );
    expect(screen.getByRole("button", { name: "Back to account" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run:

```bash
pnpm exec vitest run 'src/app/(auth)/signup/signup-form.test.tsx'
```

Expected: FAIL because the progress list and `Choose your tools` control do not exist.

- [ ] **Step 3: Add stage state, progress semantics, and navigation controls**

Add refs and local stage state inside `SignupForm`:

```tsx
type MobileStep = "account" | "modules";

const formRef = useRef<HTMLFormElement>(null);
const accountHeadingRef = useRef<HTMLHeadingElement>(null);
const modulesHeadingRef = useRef<HTMLHeadingElement>(null);
const pendingStepFocus = useRef<MobileStep | null>(null);
const [mobileStep, setMobileStep] = useState<MobileStep>("account");

function moveToStep(next: MobileStep) {
  pendingStepFocus.current = next;
  setMobileStep(next);
}

useEffect(() => {
  if (pendingStepFocus.current !== mobileStep) return;
  pendingStepFocus.current = null;
  const heading = mobileStep === "account" ? accountHeadingRef.current : modulesHeadingRef.current;
  heading?.focus();
  formRef.current?.scrollIntoView?.({ block: "start" });
}, [mobileStep]);

function advanceToModules() {
  if (!formRef.current?.reportValidity()) return;
  moveToStep("modules");
}
```

Render an ordered progress list above the stage grid:

```tsx
<ol className="grid grid-cols-2 border-b border-border lg:hidden" aria-label="Signup progress">
  {(["account", "modules"] as const).map((step, index) => (
    <li
      key={step}
      aria-current={mobileStep === step ? "step" : undefined}
      className={cn(
        "border-b-2 px-5 py-3 text-xs font-semibold",
        mobileStep === step
          ? "border-brand-blue text-brand-blue"
          : "border-transparent text-muted-foreground",
      )}
    >
      {index + 1}. {step === "account" ? "Account" : "Tools & price"}
    </li>
  ))}
</ol>
```

Attach `ref={formRef}` to the form, `tabIndex={-1}` and refs to both stage headings, and use mobile-only display classes:

```tsx
<section className={cn("min-w-0 p-5 sm:p-8 lg:block lg:p-10", mobileStep !== "account" && "hidden")}>
```

```tsx
<aside className={cn("min-w-0 border-t border-border bg-muted/30 p-5 sm:p-8 lg:block lg:border-l lg:border-t-0", mobileStep !== "modules" && "hidden")}>
```

Add `Choose your tools` at the end of Account and `Back to account` at the start of Tools & price. Mark both controls `lg:hidden`; the final submit button remains in Tools & price.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
pnpm exec vitest run 'src/app/(auth)/signup/signup-form.test.tsx'
```

Expected: PASS.

- [ ] **Step 5: Commit the stage shell**

```bash
git add 'src/app/(auth)/signup/signup-form.tsx' 'src/app/(auth)/signup/signup-form.test.tsx'
git commit -m "Add progressive mobile signup stages"
```

### Task 2: Preserve state and route validation errors

**Files:**

- Modify: `src/app/(auth)/signup/signup-form.test.tsx`
- Modify: `src/app/(auth)/signup/signup-form.tsx`

**Interfaces:**

- Consumes: `mobileStep`, `moveToStep`, and the existing uncontrolled account inputs from Task 1.
- Produces: `passwordMismatch: boolean`, inline confirmation feedback, preserved module and interval state, and server-error routing to Account.

- [ ] **Step 1: Add failing tests for validation and state preservation**

Add tests that:

```tsx
it("keeps account and module choices when moving between stages", async () => {
  const user = userEvent.setup();
  renderSignup();
  await fillPasswordAccount(user);
  await user.click(screen.getByRole("button", { name: "Choose your tools" }));
  await user.click(screen.getByRole("checkbox", { name: /Quotes/ }));
  await user.click(screen.getByRole("button", { name: /Annual/ }));
  await user.click(screen.getByRole("button", { name: "Back to account" }));

  expect(screen.getByLabelText("Work email")).toHaveValue("jane@example.com");
  await user.click(screen.getByRole("button", { name: "Choose your tools" }));
  expect(screen.getByRole("checkbox", { name: /Quotes/ })).toBeChecked();
  expect(screen.getByRole("button", { name: /Annual/ })).toHaveAttribute("aria-pressed", "true");
});

it("keeps users on Account when passwords differ", async () => {
  const user = userEvent.setup();
  renderSignup();
  await user.type(screen.getByLabelText("Work email"), "jane@example.com");
  await user.type(screen.getByLabelText("Password", { selector: "input" }), "password123");
  await user.type(screen.getByLabelText("Confirm password", { selector: "input" }), "different123");
  await user.click(screen.getByRole("button", { name: "Choose your tools" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
  expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Account");
});
```

Add a magic-link payload test:

```tsx
it("submits the preserved signup intent in magic-link mode", async () => {
  const user = userEvent.setup();
  signInWithOtpAction.mockResolvedValue({ ok: true, message: "Check your inbox." });
  render(
    <SignupForm
      intent={{ moduleKeys: ["books"], interval: "monthly", promotionCode: "SAVE25" }}
      promotion={{
        code: "SAVE25",
        label: "25% off once",
        discountType: "percentage",
        percentOff: 25,
      }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Use a magic link" }));
  await user.type(screen.getByLabelText("Work email"), "jane@example.com");
  await user.click(screen.getByRole("button", { name: "Choose your tools" }));
  await user.click(screen.getByRole("checkbox", { name: /Quotes/ }));
  await user.click(screen.getByRole("button", { name: /Annual/ }));
  await user.click(screen.getByRole("button", { name: "Email my sign-up link" }));

  expect(signInWithOtpAction).toHaveBeenCalledWith({
    email: "jane@example.com",
    mode: "signup",
    moduleKeys: ["books", "quotes"],
    interval: "annual",
    promotionCode: "SAVE25",
  });
});
```

Add a server-error routing test:

```tsx
it("returns to Account when signup returns an account error", async () => {
  const user = userEvent.setup();
  signUpAction.mockResolvedValue({ ok: false, error: "Email already registered." });
  renderSignup();
  await fillPasswordAccount(user);
  await user.click(screen.getByRole("button", { name: "Choose your tools" }));
  await user.click(screen.getByRole("button", { name: "Create account & continue" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Email already registered.");
  expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Account");
});
```

- [ ] **Step 2: Run the focused test and confirm the new cases fail**

Run:

```bash
pnpm exec vitest run 'src/app/(auth)/signup/signup-form.test.tsx'
```

Expected: FAIL on password mismatch and server-error stage routing.

- [ ] **Step 3: Implement account validation and error focus**

Track mismatch state and compare values in `advanceToModules`:

```tsx
const errorSummaryRef = useRef<HTMLParagraphElement>(null);
const [passwordMismatch, setPasswordMismatch] = useState(false);

function advanceToModules() {
  const form = formRef.current;
  if (!form?.reportValidity()) return;
  if (mode === "password") {
    const data = new FormData(form);
    if (data.get("password") !== data.get("confirm")) {
      setPasswordMismatch(true);
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
  }
  setPasswordMismatch(false);
  moveToStep("modules");
}
```

Connect the confirmation field to an inline alert with `aria-invalid` and `aria-describedby="confirm-error"`. Keep the existing final-submit comparison as a defensive server-action boundary.

Route returned errors to Account:

```tsx
useEffect(() => {
  if (!state || state.ok) return;
  setMobileStep("account");
  requestAnimationFrame(() => errorSummaryRef.current?.focus());
}, [state]);
```

Render the account error summary with `ref={errorSummaryRef}` and `tabIndex={-1}`. Keep the existing module state, interval state, and promotion props unchanged.

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run:

```bash
pnpm exec vitest run 'src/app/(auth)/signup/signup-form.test.tsx'
```

Expected: PASS for password, magic-link, preservation, and server-error cases.

- [ ] **Step 5: Commit state preservation and validation**

```bash
git add 'src/app/(auth)/signup/signup-form.tsx' 'src/app/(auth)/signup/signup-form.test.tsx'
git commit -m "Preserve signup state across mobile steps"
```

### Task 3: Repair narrow-screen reflow and touch targets

**Files:**

- Modify: `src/app/(auth)/signup/signup-form.test.tsx`
- Modify: `src/app/(auth)/signup/signup-form.tsx`
- Modify: `src/app/(auth)/signup/page.tsx`
- Modify: `src/app/(auth)/layout.tsx`

**Interfaces:**

- Consumes: the stage markup from Tasks 1 and 2.
- Produces: a 320px-safe grid, wrapping module copy, 44px billing controls, and a compact mobile header.

- [ ] **Step 1: Add failing class-contract tests for the audited defects**

Add assertions for the specific layout contracts:

```tsx
it("uses narrow-screen-safe module and billing classes", () => {
  renderSignup();

  expect(screen.getByTestId("signup-stage-grid")).toHaveClass("min-w-0");
  expect(screen.getByText("Track income, expenses, and receipts.")).not.toHaveClass("truncate");
  expect(screen.getByRole("button", { name: "Monthly" })).toHaveClass("min-h-11");
  expect(screen.getByRole("button", { name: /Annual/ })).toHaveClass("min-h-11");
});
```

- [ ] **Step 2: Run the focused test and confirm the class contract fails**

Run:

```bash
pnpm exec vitest run 'src/app/(auth)/signup/signup-form.test.tsx'
```

Expected: FAIL because the stage grid lacks the test id and min-width class, descriptions use `truncate`, and billing controls use `min-h-10`.

- [ ] **Step 3: Apply the responsive layout changes**

Use `data-testid="signup-stage-grid"` and `min-w-0` on the form grid, both stage containers, and flexible row children. Replace module `truncate` with two-line wrapping:

```tsx
<span className="line-clamp-2 text-xs leading-4 text-muted-foreground">
  {moduleMeta.description}
</span>
```

Allow the selected price row to shrink without widening the card. Stack the account-mode and sign-in controls below 400px when needed. Change billing controls to `min-h-11` and use smaller horizontal padding at the narrowest width.

In `signup/page.tsx`, reduce mobile header padding and keep the full desktop rhythm:

```tsx
<div className="flex flex-col items-center border-b border-border px-5 py-5 text-center sm:px-10 sm:py-7">
```

In the auth layout, align long mobile forms near the top while retaining centred desktop presentation:

```tsx
<div className="grid min-h-dvh place-items-start px-3 py-4 sm:px-4 sm:py-8 lg:place-items-center lg:py-12">
```

Fix the overflow at its source with flexible grid tracks and children. Do not hide horizontal overflow on `body` or the auth wrapper.

- [ ] **Step 4: Run component tests and inspect the mobile page in the in-app browser**

Run:

```bash
pnpm exec vitest run 'src/app/(auth)/signup/signup-form.test.tsx'
```

Expected: PASS.

In the in-app browser, inspect 320x568, 390x844, and 768x1024. At each width, evaluate:

```js
({
  clientWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  scrollX: window.scrollX,
})
```

Expected: `scrollWidth === clientWidth` and `scrollX === 0` before and after selecting modules and annual billing.

- [ ] **Step 5: Commit the responsive repair**

```bash
git add 'src/app/(auth)/signup/signup-form.tsx' 'src/app/(auth)/signup/signup-form.test.tsx' 'src/app/(auth)/signup/page.tsx' 'src/app/(auth)/layout.tsx'
git commit -m "Repair mobile signup reflow"
```

### Task 4: Keep workspace onboarding visible before keyboard entry

**Files:**

- Create: `src/app/onboarding/create-workspace-form.test.tsx`
- Modify: `src/app/onboarding/create-workspace-form.tsx:80-150`
- Modify: `src/app/onboarding/page.tsx:45-95`

**Interfaces:**

- Consumes: existing `CreateWorkspaceForm` props and signup intent summary.
- Produces: an unfocused initial workspace input and tighter mobile page spacing.

- [ ] **Step 1: Write the failing autofocus test**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CreateWorkspaceForm } from "./create-workspace-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/(app)/actions/workspaces", () => ({
  createWorkspaceAction: vi.fn(),
}));

vi.mock("@/app/(app)/billing/actions", () => ({
  startBillingCheckoutAction: vi.fn(),
}));

it("leaves the workspace name unfocused until the user taps it", () => {
  render(
    <CreateWorkspaceForm
      intent={{ moduleKeys: ["books", "quotes"], interval: "annual" }}
    />,
  );

  expect(screen.getByLabelText("Workspace name")).not.toHaveFocus();
  expect(screen.getByText("Your selected setup")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the onboarding test and confirm it fails**

Run:

```bash
pnpm exec vitest run src/app/onboarding/create-workspace-form.test.tsx
```

Expected: FAIL because the input receives focus through `autoFocus`.

- [ ] **Step 3: Remove autofocus and tighten mobile spacing**

Remove the `autoFocus` prop from the workspace-name input. In `onboarding/page.tsx`, use `px-4 py-8 sm:py-12`, reduce the mobile logo margin, and preserve the current `max-w-md` summary layout.

- [ ] **Step 4: Run the onboarding test and confirm it passes**

Run:

```bash
pnpm exec vitest run src/app/onboarding/create-workspace-form.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the onboarding mobile adjustment**

```bash
git add src/app/onboarding/create-workspace-form.tsx src/app/onboarding/create-workspace-form.test.tsx src/app/onboarding/page.tsx
git commit -m "Keep mobile onboarding summary visible"
```

### Task 5: Review and verify the complete flow

**Files:**

- Modify only files that need fixes from review or verification.

**Interfaces:**

- Consumes: Tasks 1 through 4.
- Produces: a verified mobile flow on `main`, synchronized with `origin/main`.

- [ ] **Step 1: Run focused tests**

```bash
pnpm exec vitest run 'src/app/(auth)/signup/signup-form.test.tsx' src/app/onboarding/create-workspace-form.test.tsx src/platform/billing/signup-intent.test.ts src/server/stripe/checkout-promotion.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run static verification**

```bash
pnpm type-check
pnpm lint
pnpm format:check
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the production build**

```bash
pnpm build
```

Expected: Next.js production build completes without errors.

- [ ] **Step 4: Verify the rendered flow in the in-app browser**

Check Account, Tools & price, magic link, unavailable promotion, check-email, and onboarding states. Capture accepted screenshots at 320x568, 390x844, 768x1024, and desktop. Confirm stage focus, Back behaviour, state preservation, 44px targets, and zero horizontal overflow.

- [ ] **Step 5: Run React best-practices review and fix actionable findings**

Review the changed TSX files for client-boundary size, effect dependencies, form semantics, state duplication, and avoidable renders. Re-run the focused tests after any fix.

- [ ] **Step 6: Commit verification fixes if needed**

```bash
git add 'src/app/(auth)/signup/signup-form.tsx' 'src/app/(auth)/signup/signup-form.test.tsx' 'src/app/(auth)/signup/page.tsx' 'src/app/(auth)/layout.tsx' src/app/onboarding/create-workspace-form.tsx src/app/onboarding/create-workspace-form.test.tsx src/app/onboarding/page.tsx
git commit -m "Polish mobile signup verification findings"
```

Skip this commit when review produces no file changes.

- [ ] **Step 7: Rebase and push main**

```bash
git fetch origin
git rebase origin/main
git push origin main
```

Expected: `main` and `origin/main` point to the same verified commit.
