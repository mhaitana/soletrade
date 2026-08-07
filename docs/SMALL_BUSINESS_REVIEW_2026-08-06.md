# Small-business platform review

**Reviewed:** 6 August 2026

**Scope:** authenticated workspace, dashboard, navigation, customers, invoices, quotes, books, receipts, tax, drive, files, assistant, settings, permissions, billing, and the main public flows.

## Product assessment

Soletrade Suite has a sound foundation for an Australian sole trader or small team. Workspace isolation, integer-cent money storage, audit events, module permissions, invoice and quote lifecycles, receipt extraction, GST reporting, mileage, and public payment flows cover a useful core.

The main weakness was coordination. Owners had to open several modules to find overdue invoices, accepted quotes, draft work, and receipts awaiting review. The dashboard reported figures but did not tell the owner what to do next. Create actions also depended on the current page, and the selected workspace currency did not reach several forms and summaries.

## Improvements made in this pass

### Daily workflow

- Added a permission-aware **New** menu to the app header for invoices, quotes, transactions, drive entries, and customers.
- Rebuilt the dashboard around a **Needs attention** queue. Owners can open overdue invoices, accepted quotes, pending receipt reviews, and draft invoices from one place.
- Made KPI cards clickable and gave empty states a route to the relevant task.
- Put installed work modules in the mobile bottom navigation. Billing and other administration stay under **More**.
- Changed the mobile period selector from a tall wrapped control to a horizontal touch target.

### Business logic and language

- Renamed **Cash position** to **Net cash flow**. The value measures income minus expenses for the selected period and is not a bank balance.
- Renamed **Pending quotes** to **Ready to invoice**. The value represents accepted quotes that still need conversion.
- Changed quote module metrics to show the ready value and waiting count without mixing an all-time snapshot with a period count.
- Repaired legacy activity labels such as `quote.accepted` and `invoice.sent`, so owners see normal sentences.
- Enabled the existing employee `create:invoice` and `create:quote` permissions on the matching create flows.

### Money and currency

- Applied the workspace currency to invoices, quotes, books, tax, drive, receipt extraction, and assistant overviews.
- Preserved the original currency when users edit an existing record.
- Added currency-aware form labels and unit-price hints.
- Added supported symbols and thousands separators to money displays.
- Corrected receipt extraction to request a three-letter ISO 4217 code and use the workspace currency when the receipt does not show one.

### First-use experience

- Marked workspace creation as complete in the zero-module onboarding checklist.
- Added the workspace name and a plain description of the selected period to the dashboard.
- Replaced misleading “no activity” copy with “no completed activity this period.”

## Recommended product roadmap

### P0: finish the sales-to-cash loop

1. Add a business profile with legal name, trading name, ABN, GST registration, address, phone, email, logo, and invoice footer. Use it on invoices, quotes, PDFs, emails, and public pages.
2. Add workspace defaults for payment terms, tax rate, prices including GST, quote validity, invoice notes, and payment instructions. New documents should start ready for the owner to review.
3. Add scheduled invoice reminders with an owner-controlled cadence, pause switch, and reminder history.
4. Add a customer account view that combines quotes, invoices, payments, notes, and outstanding value.
5. Add recurring invoices and saved line-item templates for retainers and repeat jobs.

### P1: reduce bookkeeping effort

1. Add bank import or bank feeds, then match transactions against invoices and receipts.
2. Unify receipt upload and expense entry into one flow. The owner should upload, review extracted fields, and save without switching screens.
3. Add reconciliation states, duplicate detection, and a month-end checklist.
4. Add BAS-ready summaries with GST collected, GST paid, sales, expenses, adjustments, and exportable evidence for the accountant.
5. Add cash forecasts based on invoice due dates, recurring expenses, and expected quote conversion. Label forecasts as estimates.

### P2: support growing teams

1. Add jobs or projects that connect a customer, quote, invoice, expenses, files, mileage, and margin.
2. Add approval rules for expenses, write-offs, refunds, and tax lodgement.
3. Add page-level saved views and role-specific home screens for owners, accountants, managers, and employees.
4. Add bulk actions and keyset pagination before invoice, quote, customer, or transaction lists grow past their current caps.

## Engineering priorities

- Move dashboard totals and trends to database-side aggregates, then cache short-lived workspace summaries.
- Add or confirm compound indexes for workspace activity, audit history, customer ordering, and module list cursors.
- Queue PDF and email work so sending an invoice does not wait on network services.
- Mock notification storage and PDF dependencies in unit tests. The current notification test file reaches PostgREST and times out when that dependency is unavailable.
- Add browser tests for quote-to-invoice conversion, invoice payment, receipt-to-transaction review, currency changes, and permission-specific create actions.

## Success measures

Track the time from sign-in to the first completed task, accepted-quote conversion time, overdue invoice age, receipt review backlog, invoice payment time, and the share of new documents that owners can send without changing workspace defaults. These measures connect product work to saved admin time and cash collection.
