-- ============================================================================
-- soletrade OS - local development seed (auto-run by `supabase db reset`)
-- ============================================================================
--config.toml [db.seed] enabled=true, sql_paths=["./seed.sql"] → this file runs
-- after the 4 migrations on every `pnpm db:reset`. LOCAL-DEV ONLY: `supabase db
-- push` does NOT run seed.sql on the remote, so these test users never reach prod.
--
-- Dev login credentials (password for ALL users: password123):
--   owner@soletrade.test        (owner  of WS1 + WS2)
--   admin@soletrade.test        (admin  in WS1)
--   accountant@soletrade.test   (accountant in WS1)
--   employee@soletrade.test     (employee in WS1)
--   readonly@soletrade.test     (readonly in WS1)
--   pending@soletrade.test      (pending invitation, not yet a member)
--
-- Coverage: 2 workspaces, all 4 modules, every lifecycle status across
-- invoices/quotes/books/drive, all 13 enum values, cross-module source links
-- (InvoicePaid→Books, Drive→Books income/mileage/expense), all 6 credit entry
-- types, tax periods, activity/audit/notifications, AI conversation, files,
-- receipt extractions. UUID namespace 11111111-1111-4111-8111-… (valid v4,
-- disjoint from every integration-test fixed UUID which uses 0000-…-8000-…).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; -- crypt()/gen_salt() for auth.users passwords

-- ----------------------------------------------------------------------------
-- 1. Auth users + public.users mirror (same UUID in both → password login works)
-- ----------------------------------------------------------------------------
-- GoTrue scans several auth.users columns as non-nullable strings (confirmation_token,
-- recovery_token, email_change_token_new, email_change, phone) even though the columns
-- default to NULL. A NULL in any of them makes the password-login query fail with
-- "Database error querying schema" (sql: Scan error … converting NULL to string is
-- unsupported). Set them to '' explicitly, and is_super_admin to false.
INSERT INTO auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   confirmation_token, recovery_token, email_change_token_new, email_change,
   is_super_admin,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at)
VALUES
  ('11111111-1111-4111-8111-111111110001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner@soletrade.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '', '', '', '', false,
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Alex Owner"}'::jsonb, now(), now(), now()),
  ('11111111-1111-4111-8111-111111110002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@soletrade.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '', '', '', '', false,
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Avery Admin"}'::jsonb, now(), now(), now()),
  ('11111111-1111-4111-8111-111111110003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'accountant@soletrade.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '', '', '', '', false,
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Quinn Accountant"}'::jsonb, now(), now(), now()),
  ('11111111-1111-4111-8111-111111110004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'employee@soletrade.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '', '', '', '', false,
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Ellie Employee"}'::jsonb, now(), now(), now()),
  ('11111111-1111-4111-8111-111111110005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'readonly@soletrade.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '', '', '', '', false,
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Robin Readonly"}'::jsonb, now(), now(), now()),
  ('11111111-1111-4111-8111-111111110006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pending@soletrade.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '', '', '', '', false,
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Pat Pending"}'::jsonb, now(), now(), now()),
  ('11111111-1111-4111-8111-111111110099', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@soletrade.example',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '', '', '', '', false,
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Soletrade Super Admin"}'::jsonb, now(), now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, full_name, created_at, updated_at) VALUES
  ('11111111-1111-4111-8111-111111110001', 'owner@soletrade.test',      'Alex Owner',       now(), now()),
  ('11111111-1111-4111-8111-111111110002', 'admin@soletrade.test',      'Avery Admin',      now(), now()),
  ('11111111-1111-4111-8111-111111110003', 'accountant@soletrade.test', 'Quinn Accountant', now(), now()),
  ('11111111-1111-4111-8111-111111110004', 'employee@soletrade.test',   'Ellie Employee',   now(), now()),
  ('11111111-1111-4111-8111-111111110005', 'readonly@soletrade.test',   'Robin Readonly',   now(), now()),
  ('11111111-1111-4111-8111-111111110006', 'pending@soletrade.test',    'Pat Pending',      now(), now()),
  ('11111111-1111-4111-8111-111111110099', 'admin@soletrade.example',  'Soletrade Super Admin', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Workspaces (WS1 full demo, WS2 smaller NZD studio - owner owns both)
-- ----------------------------------------------------------------------------
INSERT INTO workspaces
  (id, name, slug, owner_user_id, default_currency, timezone, invoice_prefix, quote_prefix, fy_start_month, payment_methods, created_at)
VALUES
  ('11111111-1111-4111-8111-111111111010', 'Soletrade Demo Co',  'soletrade-demo', '11111111-1111-4111-8111-111111110001',
   'AUD', 'Australia/Sydney', 'INV-', 'QUO-', 7,
   '[{"type":"bank_transfer","label":"Soletrade Demo Account","accountName":"Soletrade Demo Co","bsb":"062-000","accountNumber":"12345678","bankName":"Commonwealth Bank","reference":"Invoice number"},{"type":"payid","identifier":"demo@soletrade.test"}]'::jsonb,
   '2025-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111020', 'Bellflower Studio', 'bellflower',   '11111111-1111-4111-8111-111111110001',
   'NZD', 'Pacific/Auckland', 'BF-',  'QB-',  4,
   '[{"type":"bank_transfer","label":"Bellflower Account","accountName":"Bellflower Studio","bsb":"01-0001","accountNumber":"987654321","bankName":"ANZ","reference":"Invoice number"}]'::jsonb,
   '2025-04-01 00:00:00');

-- ----------------------------------------------------------------------------
-- 3. Workspace members (all 5 roles in WS1; owner-only in WS2)
-- ----------------------------------------------------------------------------
INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES
  ('11111111-1111-4111-8111-111111111010', '11111111-1111-4111-8111-111111110001', 'owner',      '2025-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111010', '11111111-1111-4111-8111-111111110002', 'admin',      '2025-08-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111010', '11111111-1111-4111-8111-111111110003', 'accountant', '2025-09-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111010', '11111111-1111-4111-8111-111111110004', 'employee',   '2025-10-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111010', '11111111-1111-4111-8111-111111110005', 'readonly',   '2025-11-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111020', '11111111-1111-4111-8111-111111110001', 'owner',      '2025-04-01 00:00:00');

-- ----------------------------------------------------------------------------
-- 4. Workspace invitations (pending / accepted / revoked)
-- ----------------------------------------------------------------------------
INSERT INTO workspace_invitations
  (id, workspace_id, email, role, invited_by_user_id, token, status, expires_at, accepted_at, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110901', '11111111-1111-4111-8111-111111111010',
   'pending@soletrade.test', 'manager', '11111111-1111-4111-8111-111111110001',
   'inv-seed-pending-token-0001', 'pending',
   '2099-12-31 00:00:00', NULL, '2026-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110902', '11111111-1111-4111-8111-111111111010',
   'admin@soletrade.test', 'admin', '11111111-1111-4111-8111-111111110001',
   'inv-seed-accepted-token-0002', 'accepted',
   '2025-09-01 00:00:00', '2025-08-01 00:00:00', '2025-07-15 00:00:00'),
  ('11111111-1111-4111-8111-111111110903', '11111111-1111-4111-8111-111111111010',
   'revoked@soletrade.test', 'employee', '11111111-1111-4111-8111-111111110001',
   'inv-seed-revoked-token-0003', 'revoked',
   '2025-12-01 00:00:00', NULL, '2025-10-01 00:00:00');

-- ----------------------------------------------------------------------------
-- 5. Subscriptions (1:1 per workspace) + module installations
-- ----------------------------------------------------------------------------
INSERT INTO subscriptions
  (workspace_id, status, billing_interval, anchor_billing_date, created_at)
VALUES
  ('11111111-1111-4111-8111-111111111010', 'active', 'monthly', '2025-07-01 00:00:00', '2025-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111020', 'active', 'annual',  '2025-04-01 00:00:00', '2025-04-01 00:00:00');

INSERT INTO module_installations
  (workspace_id, module_key, status, installed_at, pending_cancellation_at)
VALUES
  ('11111111-1111-4111-8111-111111111010', 'invoices', 'active', '2025-07-01 00:00:00', NULL),
  ('11111111-1111-4111-8111-111111111010', 'books',    'active', '2025-07-02 00:00:00', NULL),
  ('11111111-1111-4111-8111-111111111010', 'drive',    'active', '2025-07-03 00:00:00', '2026-09-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111010', 'quotes',   'active', '2025-07-04 00:00:00', NULL),
  ('11111111-1111-4111-8111-111111111020', 'invoices', 'active', '2025-04-01 00:00:00', NULL),
  ('11111111-1111-4111-8111-111111111020', 'quotes',   'active', '2025-04-02 00:00:00', NULL);

-- ----------------------------------------------------------------------------
-- 6. Customers (WS1: 6 incl. soft-deleted + walk-in; WS2: 2)
-- ----------------------------------------------------------------------------
INSERT INTO customers
  (id, workspace_id, name, email, phone, company, notes, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110101', '11111111-1111-4111-8111-111111111010',
   'Acme Corp', 'accounts@acme.test', '0400000001', 'Acme Pty Ltd', 'VIP - net-15 terms', '2025-07-05 00:00:00'),
  ('11111111-1111-4111-8111-111111110102', '11111111-1111-4111-8111-111111111010',
   'Jordan Lee', 'jordan@example.test', '0400000002', NULL, NULL, '2025-07-20 00:00:00'),
  ('11111111-1111-4111-8111-111111110103', '11111111-1111-4111-8111-111111111010',
   'Smith Plumbing', 'smith@plumb.test', NULL, 'Smith Plumbing Co', NULL, '2025-08-10 00:00:00'),
  ('11111111-1111-4111-8111-111111110104', '11111111-1111-4111-8111-111111111010',
   'Walk-in Customer', NULL, '0400000004', NULL, 'No email on file', '2025-09-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110105', '11111111-1111-4111-8111-111111111010',
   'Beta Industries', 'ap@beta.test', '0400000005', 'Beta Ltd', NULL, '2025-10-15 00:00:00'),
  ('11111111-1111-4111-8111-111111110106', '11111111-1111-4111-8111-111111111010',
   'Gamma LLC', 'gamma@g.test', NULL, 'Gamma LLC', NULL, '2025-06-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110201', '11111111-1111-4111-8111-111111111020',
   'NZ Client', 'kiwi@nz.test', NULL, 'Kiwi Co', NULL, '2025-04-10 00:00:00'),
  ('11111111-1111-4111-8111-111111110202', '11111111-1111-4111-8111-111111111020',
   'Auckland Cafe', 'cafe@akl.nz', '0210000008', NULL, NULL, '2025-05-01 00:00:00');

-- soft-delete Gamma LLC (demonstrates the deleted_at filter in lists)
UPDATE customers SET deleted_at = '2025-12-01 00:00:00'
  WHERE id = '11111111-1111-4111-8111-111111110106';

-- ----------------------------------------------------------------------------
-- 7. Vehicles + driver profile (mileage rate 88 c/km, default = van)
-- ----------------------------------------------------------------------------
INSERT INTO vehicles
  (id, workspace_id, name, make, model, year, odometer_km, active, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110301', '11111111-1111-4111-8111-111111111010',
   'Cargo Van', 'Mercedes', 'Sprinter', 2022, 12800, true, '2025-07-03 00:00:00'),
  ('11111111-1111-4111-8111-111111110302', '11111111-1111-4111-8111-111111111010',
   'Sedan', 'Toyota', 'Camry', 2020, 95000, true, '2025-07-03 00:00:00');

INSERT INTO driver_profiles
  (workspace_id, mileage_rate_cents_per_km, default_vehicle_id, created_at)
VALUES
  ('11111111-1111-4111-8111-111111111010', 88,
   '11111111-1111-4111-8111-111111110301', '2025-07-03 00:00:00');

-- ----------------------------------------------------------------------------
-- 8. Drive earnings / trips / vehicle expenses (Jan–Jul 2026)
-- ----------------------------------------------------------------------------
INSERT INTO drive_earnings
  (id, workspace_id, platform, amount_cents, currency, date, description, notes, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110401', '11111111-1111-4111-8111-111111111010',
   'uber', 12050, 'AUD', '2026-01-20 00:00:00', 'Airport run', 'Peak surge', '2026-01-20 00:00:00'),
  ('11111111-1111-4111-8111-111111110402', '11111111-1111-4111-8111-111111111010',
   'doordash', 8000, 'AUD', '2026-04-10 00:00:00', 'Evening deliveries', NULL, '2026-04-10 00:00:00'),
  ('11111111-1111-4111-8111-111111110403', '11111111-1111-4111-8111-111111111010',
   'airtasker', 25000, 'AUD', '2026-06-05 00:00:00', 'Furniture assembly', '2h job', '2026-06-05 00:00:00');

INSERT INTO drive_trips
  (id, workspace_id, platform, distance_meters, date, purpose, notes, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110501', '11111111-1111-4111-8111-111111111010',
   'uber', 200000, '2026-02-10 00:00:00', 'Client visit', 'Return trip', '2026-02-10 00:00:00'),
  ('11111111-1111-4111-8111-111111110502', '11111111-1111-4111-8111-111111111010',
   'doordash', 150000, '2026-05-18 00:00:00', 'Deliveries', NULL, '2026-05-18 00:00:00');

INSERT INTO driver_vehicle_expenses
  (id, workspace_id, vehicle_id, type, amount_cents, currency, date, odometer_km, description, notes, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110601', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110301', 'fuel', 9000, 'AUD',
   '2026-02-15 00:00:00', 12050, 'Refuel', NULL, '2026-02-15 00:00:00'),
  ('11111111-1111-4111-8111-111111110602', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110301', 'maintenance', 33000, 'AUD',
   '2026-05-01 00:00:00', 12800, 'Service + tyres', 'Logbook serviced', '2026-05-01 00:00:00');

-- ----------------------------------------------------------------------------
-- 9. Invoices - one per status (draft/sent/viewed/paid/void/overdue) + line items
--    Numbers INV-2026-0001..0006. Totals hand-computed (cents).
--    i3 has a fractional qty 1.5 (numeric(12,2) regression). i6 is tax-inclusive.
-- ----------------------------------------------------------------------------
INSERT INTO invoices
  (id, workspace_id, customer_id, number, status, issue_date, due_date, currency,
   tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes,
   public_token, sent_at, paid_at, stripe_payment_intent_id, stripe_charge_id, created_at)
VALUES
  -- i1 draft, tax 0, 2 lines → subtotal 320000, total 320000
  ('11111111-1111-4111-8111-111111110701', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110101', 'INV-2026-0001', 'draft',
   '2026-07-01 00:00:00', NULL, 'AUD', 0, false, 320000, 0, 320000,
   'Pending client sign-off.', NULL, NULL, NULL, NULL, NULL, '2026-07-01 00:00:00'),
  -- i2 sent, tax 10%, 1 line → subtotal 150000, tax 15000, total 165000
  ('11111111-1111-4111-8111-111111110702', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110102', 'INV-2026-0002', 'sent',
   '2026-06-15 00:00:00', '2026-07-15 00:00:00', 'AUD', 10, false, 150000, 15000, 165000,
   'Annual hosting.', 'inv-seed-0002', '2026-06-16 00:00:00', NULL, NULL, NULL, '2026-06-15 00:00:00'),
  -- i3 viewed, tax 10%, 2 lines incl. qty 1.5 → subtotal 800000, tax 80000, total 880000
  ('11111111-1111-4111-8111-111111110703', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110103', 'INV-2026-0003', 'viewed',
   '2026-06-01 00:00:00', '2026-07-01 00:00:00', 'AUD', 10, false, 800000, 80000, 880000,
   NULL, 'inv-seed-0003', '2026-06-02 00:00:00', NULL, NULL, NULL, '2026-06-01 00:00:00'),
  -- i4 paid, tax 10%, 2 lines → subtotal 2300000, tax 230000, total 2530000 (cross-module → Books bx1)
  ('11111111-1111-4111-8111-111111110704', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110101', 'INV-2026-0004', 'paid',
   '2026-05-01 00:00:00', '2026-05-31 00:00:00', 'AUD', 10, false, 2300000, 230000, 2530000,
   'Paid via card.', 'inv-seed-0004', '2026-05-02 00:00:00', '2026-05-20 00:00:00',
   'pi_seed_0004', 'ch_seed_0004', '2026-05-01 00:00:00'),
  -- i5 void, tax 0, 1 line → subtotal 500000, total 500000
  ('11111111-1111-4111-8111-111111110705', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110104', 'INV-2026-0005', 'void',
   '2026-04-01 00:00:00', NULL, 'AUD', 0, false, 500000, 0, 500000,
   'Cancelled - duplicate.', NULL, NULL, NULL, NULL, NULL, '2026-04-01 00:00:00'),
  -- i6 overdue, tax 10%, tax-INCLUSIVE, 1 line → total 1100000, subtotal 1000000, tax 100000
  ('11111111-1111-4111-8111-111111110706', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110105', 'INV-2026-0006', 'overdue',
   '2026-03-01 00:00:00', '2026-03-31 00:00:00', 'AUD', 10, true, 1000000, 100000, 1100000,
   NULL, 'inv-seed-0006', '2026-03-02 00:00:00', NULL, NULL, NULL, '2026-03-01 00:00:00');

INSERT INTO invoice_line_items
  (id, invoice_id, workspace_id, description, quantity, unit_price_cents, amount_cents, position, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110711', '11111111-1111-4111-8111-111111110701',
   '11111111-1111-4111-8111-111111111010', 'Design work', 2, 120000, 240000, 0, '2026-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110712', '11111111-1111-4111-8111-111111110701',
   '11111111-1111-4111-8111-111111111010', 'Consulting', 1, 80000, 80000, 1, '2026-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110721', '11111111-1111-4111-8111-111111110702',
   '11111111-1111-4111-8111-111111111010', 'Hosting (annual)', 1, 150000, 150000, 0, '2026-06-15 00:00:00'),
  ('11111111-1111-4111-8111-111111110731', '11111111-1111-4111-8111-111111110703',
   '11111111-1111-4111-8111-111111111010', 'Dev sprint', 1.5, 400000, 600000, 0, '2026-06-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110732', '11111111-1111-4111-8111-111111110703',
   '11111111-1111-4111-8111-111111111010', 'Bug fix', 1, 200000, 200000, 1, '2026-06-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110741', '11111111-1111-4111-8111-111111110704',
   '11111111-1111-4111-8111-111111111010', 'Migration project', 1, 2000000, 2000000, 0, '2026-05-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110742', '11111111-1111-4111-8111-111111110704',
   '11111111-1111-4111-8111-111111111010', 'Training', 2, 150000, 300000, 1, '2026-05-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110751', '11111111-1111-4111-8111-111111110705',
   '11111111-1111-4111-8111-111111111010', 'Cancelled retainer', 1, 500000, 500000, 0, '2026-04-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110761', '11111111-1111-4111-8111-111111110706',
   '11111111-1111-4111-8111-111111111010', 'Support plan', 1, 1100000, 1100000, 0, '2026-03-01 00:00:00');

-- ----------------------------------------------------------------------------
-- 10. Quotes - one per status (draft/sent/viewed/accepted/declined/expired/converted)
--     Numbers QUO-2026-0001..0007. q2 has sections + T&Cs. q4 accepted → acceptance row.
--     q7 converted → converted_invoice_id = i4.
-- ----------------------------------------------------------------------------
INSERT INTO quotes
  (id, workspace_id, customer_id, number, status, issue_date, valid_until, currency,
   tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes,
   terms_conditions, public_token, sent_at, accepted_at, declined_at, converted_at,
   converted_invoice_id, created_at)
VALUES
  -- q1 draft, tax 10% → subtotal 800000, tax 80000, total 880000
  ('11111111-1111-4111-8111-111111110801', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110101', 'QUO-2026-0001', 'draft',
   '2026-07-05 00:00:00', '2026-08-05 00:00:00', 'AUD', 10, false, 800000, 80000, 880000,
   'Scope subject to discovery.', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-05 00:00:00'),
  -- q2 sent, tax 10%, 2 lines + sections + T&Cs → subtotal 1200000, tax 120000, total 1320000
  ('11111111-1111-4111-8111-111111110802', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110102', 'QUO-2026-0002', 'sent',
   '2026-06-20 00:00:00', '2026-07-20 00:00:00', 'AUD', 10, false, 1200000, 120000, 1320000,
   NULL, '50% deposit upfront, balance on delivery.', 'quo-seed-0002',
   '2026-06-21 00:00:00', NULL, NULL, NULL, NULL, '2026-06-20 00:00:00'),
  -- q3 viewed, tax 0 → subtotal 300000, total 300000
  ('11111111-1111-4111-8111-111111110803', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110103', 'QUO-2026-0003', 'viewed',
   '2026-06-10 00:00:00', '2026-07-10 00:00:00', 'AUD', 0, false, 300000, 0, 300000,
   NULL, NULL, 'quo-seed-0003', '2026-06-11 00:00:00', NULL, NULL, NULL, NULL, '2026-06-10 00:00:00'),
  -- q4 accepted, tax 10% → subtotal 400000, tax 40000, total 440000 (acceptance row below)
  ('11111111-1111-4111-8111-111111110804', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110104', 'QUO-2026-0004', 'accepted',
   '2026-05-10 00:00:00', '2026-06-10 00:00:00', 'AUD', 10, false, 400000, 40000, 440000,
   NULL, NULL, 'quo-seed-0004', '2026-05-11 00:00:00', '2026-05-25 00:00:00',
   NULL, NULL, NULL, '2026-05-10 00:00:00'),
  -- q5 declined, tax 10% → subtotal 5000000, tax 500000, total 5500000
  ('11111111-1111-4111-8111-111111110805', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110105', 'QUO-2026-0005', 'declined',
   '2026-04-01 00:00:00', '2026-05-01 00:00:00', 'AUD', 10, false, 5000000, 500000, 5500000,
   NULL, NULL, 'quo-seed-0005', '2026-04-02 00:00:00', NULL, '2026-04-15 00:00:00',
   NULL, NULL, '2026-04-01 00:00:00'),
  -- q6 expired, tax 0 → subtotal 100000, total 100000 (valid_until in the past)
  ('11111111-1111-4111-8111-111111110806', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110106', 'QUO-2026-0006', 'expired',
   '2026-02-01 00:00:00', '2026-02-15 00:00:00', 'AUD', 0, false, 100000, 0, 100000,
   NULL, NULL, 'quo-seed-0006', '2026-02-02 00:00:00', NULL, NULL, NULL, NULL, '2026-02-01 00:00:00'),
  -- q7 converted, tax 10% → subtotal 200000, tax 20000, total 220000 → converted_invoice_id = i4
  ('11111111-1111-4111-8111-111111110807', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110101', 'QUO-2026-0007', 'converted',
   '2026-05-05 00:00:00', '2026-06-05 00:00:00', 'AUD', 10, false, 200000, 20000, 220000,
   NULL, NULL, 'quo-seed-0007', '2026-05-06 00:00:00', '2026-05-10 00:00:00',
   NULL, '2026-05-12 00:00:00', '11111111-1111-4111-8111-111111110704', '2026-05-05 00:00:00');

INSERT INTO quote_line_items
  (id, quote_id, workspace_id, description, quantity, unit_price_cents, amount_cents, position, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110811', '11111111-1111-4111-8111-111111110801',
   '11111111-1111-4111-8111-111111111010', 'Website redesign', 1, 800000, 800000, 0, '2026-07-05 00:00:00'),
  ('11111111-1111-4111-8111-111111110821', '11111111-1111-4111-8111-111111110802',
   '11111111-1111-4111-8111-111111111010', 'Phase 1 - Design', 1, 500000, 500000, 0, '2026-06-20 00:00:00'),
  ('11111111-1111-4111-8111-111111110822', '11111111-1111-4111-8111-111111110802',
   '11111111-1111-4111-8111-111111111010', 'Phase 2 - Build', 1, 700000, 700000, 1, '2026-06-20 00:00:00'),
  ('11111111-1111-4111-8111-111111110831', '11111111-1111-4111-8111-111111110803',
   '11111111-1111-4111-8111-111111111010', 'Security audit', 1, 300000, 300000, 0, '2026-06-10 00:00:00'),
  ('11111111-1111-4111-8111-111111110841', '11111111-1111-4111-8111-111111110804',
   '11111111-1111-4111-8111-111111111010', 'Monthly retainer', 1, 400000, 400000, 0, '2026-05-10 00:00:00'),
  ('11111111-1111-4111-8111-111111110851', '11111111-1111-4111-8111-111111110805',
   '11111111-1111-4111-8111-111111111010', 'Large platform build', 1, 5000000, 5000000, 0, '2026-04-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110861', '11111111-1111-4111-8111-111111110806',
   '11111111-1111-4111-8111-111111111010', 'Quick fix', 1, 100000, 100000, 0, '2026-02-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110871', '11111111-1111-4111-8111-111111110807',
   '11111111-1111-4111-8111-111111111010', 'Setup & onboarding', 1, 200000, 200000, 0, '2026-05-05 00:00:00');

-- q2 sections (Overview + Timeline)
INSERT INTO quote_sections
  (id, quote_id, workspace_id, title, body, position, optional, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110891', '11111111-1111-4111-8111-111111110802',
   '11111111-1111-4111-8111-111111111010', 'Overview',
   'A two-phase engagement: design then build. Fixed scope, time-boxed to four weeks per phase.',
   0, false, '2026-06-20 00:00:00'),
  ('11111111-1111-4111-8111-111111110892', '11111111-1111-4111-8111-111111110802',
   '11111111-1111-4111-8111-111111111010', 'Timeline',
   'Phase 1 weeks 1–4, Phase 2 weeks 5–8. Weekly check-ins. Launch by end of week 8.',
   1, true, '2026-06-20 00:00:00');

-- q4 acceptance metadata
INSERT INTO quote_acceptances
  (id, quote_id, workspace_id, accepter_name, accepter_email, ip_address, user_agent, signature, accepted_at, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110901', '11111111-1111-4111-8111-111111110804',
   '11111111-1111-4111-8111-111111111010', 'Jordan Lee', 'jordan@example.test',
   '203.0.113.10', 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15', 'JL~', '2026-05-25 00:00:00', '2026-05-25 00:00:00');

-- ----------------------------------------------------------------------------
-- 13. Files (referenced by receipt extractions + books receipt_file_id)
-- ----------------------------------------------------------------------------
INSERT INTO files
  (id, workspace_id, uploaded_by_user_id, file_name, storage_path, mime_type, size_bytes, entity_type, entity_id, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110a01', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'receipt-coles.png',
   'seed/receipt-coles.png', 'image/png', 240000, 'receipt',
   '11111111-1111-4111-8111-111111110b01', '2026-01-18 00:00:00'),
  ('11111111-1111-4111-8111-111111110a02', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'receipt-fuel.jpg',
   'seed/receipt-fuel.jpg', 'image/jpeg', 510000, 'receipt',
   '11111111-1111-4111-8111-111111110b02', '2026-02-15 00:00:00'),
  ('11111111-1111-4111-8111-111111110a03', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'receipt-office.png',
   'seed/receipt-office.png', 'image/png', 320000, 'receipt',
   '11111111-1111-4111-8111-111111110b03', '2026-03-12 00:00:00'),
  ('11111111-1111-4111-8111-111111110a04', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'receipt-unclear.jpg',
   'seed/receipt-unclear.jpg', 'image/jpeg', 180000, 'receipt',
   '11111111-1111-4111-8111-111111110b04', '2026-04-22 00:00:00');

-- ----------------------------------------------------------------------------
-- 11. Books transactions - income/expense + all 4 cross-module source links
--     Categories from src/shared/constants/books-categories. Spread Jan–Jul 2026.
-- ----------------------------------------------------------------------------
-- Durable source-sync triggers now create mirror rows while the source fixtures
-- above are inserted. Replace those generated rows with the deterministic seed
-- fixtures below (stable ids, dates, GST, and receipt links) instead of colliding
-- with the partial unique source indexes.
DELETE FROM book_transactions
WHERE workspace_id = '11111111-1111-4111-8111-111111111010'
  AND (
    source_invoice_id IS NOT NULL
    OR source_earning_id IS NOT NULL
    OR source_expense_id IS NOT NULL
    OR source_trip_id IS NOT NULL
  );

INSERT INTO book_transactions
  (id, workspace_id, type, amount_cents, currency, date, description, category,
   customer_id, notes, gst_cents, source_invoice_id, source_earning_id,
   source_expense_id, source_trip_id, receipt_file_id, created_at)
VALUES
  -- bx1 income from paid invoice i4 (InvoicePaid → Books cross-module mirror)
  ('11111111-1111-4111-8111-111111110901', '11111111-1111-4111-8111-111111111010',
   'income', 2530000, 'AUD', '2026-05-20 00:00:00', 'Invoice INV-2026-0004 paid', 'invoice',
   '11111111-1111-4111-8111-111111110101', 'Auto-recorded from invoice payment.', 230000,
   '11111111-1111-4111-8111-111111110704', NULL, NULL, NULL, NULL, '2026-05-20 00:00:00'),
  -- bx2 income from Drive earning e1 (DriveEarningsLogged → Books)
  ('11111111-1111-4111-8111-111111110902', '11111111-1111-4111-8111-111111111010',
   'income', 12050, 'AUD', '2026-01-20 00:00:00', 'Drive earnings · Uber', 'gig',
   NULL, 'Auto-recorded from drive earnings (Uber).', 0,
   NULL, '11111111-1111-4111-8111-111111110401', NULL, NULL, NULL, '2026-01-20 00:00:00'),
  -- bx3 expense from Drive trip t1 (MileageLogged → Books, 200km × 88c = 17600)
  ('11111111-1111-4111-8111-111111110903', '11111111-1111-4111-8111-111111111010',
   'expense', 17600, 'AUD', '2026-02-10 00:00:00', 'Mileage · 200km', 'mileage',
   NULL, 'Auto-recorded from drive trip.', 0,
   NULL, NULL, NULL, '11111111-1111-4111-8111-111111110501', NULL, '2026-02-10 00:00:00'),
  -- bx4 expense from vehicle expense ve1 (VehicleExpenseLogged → Books, fuel, tax-inclusive GST 818)
  ('11111111-1111-4111-8111-111111110904', '11111111-1111-4111-8111-111111111010',
   'expense', 9000, 'AUD', '2026-02-15 00:00:00', 'Vehicle expense · Fuel', 'vehicle_expense',
   NULL, 'Auto-recorded from vehicle expense.', 818,
   NULL, NULL, '11111111-1111-4111-8111-111111110601', NULL,
   '11111111-1111-4111-8111-111111110a02', '2026-02-15 00:00:00'),
  -- bx5 manual income, retail sales (exclusive GST: amount 550000, gst 50000)
  ('11111111-1111-4111-8111-111111110905', '11111111-1111-4111-8111-111111111010',
   'income', 550000, 'AUD', '2026-03-05 00:00:00', 'Retail sales (March)', 'sales',
   NULL, NULL, 50000, NULL, NULL, NULL, NULL, NULL, '2026-03-05 00:00:00'),
  -- bx6 manual expense, office supplies (tax-inclusive: 120000, gst 10909)
  ('11111111-1111-4111-8111-111111110906', '11111111-1111-4111-8111-111111111010',
   'expense', 120000, 'AUD', '2026-01-15 00:00:00', 'Office supplies', 'supplies',
   NULL, NULL, 10909, NULL, NULL, NULL, NULL,
   '11111111-1111-4111-8111-111111110a03', '2026-01-15 00:00:00'),
  -- bx7 manual expense, SaaS subscriptions (tax-inclusive: 45000, gst 4091)
  ('11111111-1111-4111-8111-111111110907', '11111111-1111-4111-8111-111111111010',
   'expense', 45000, 'AUD', '2026-04-01 00:00:00', 'SaaS subscriptions', 'software_expense',
   NULL, 'Monthly tooling.', 4091, NULL, NULL, NULL, NULL, NULL, '2026-04-01 00:00:00'),
  -- bx8 manual income, consulting fees (tax-inclusive: 800000, gst 72727)
  ('11111111-1111-4111-8111-111111110908', '11111111-1111-4111-8111-111111111010',
   'income', 800000, 'AUD', '2026-06-01 00:00:00', 'Consulting fees', 'services',
   '11111111-1111-4111-8111-111111110102', NULL, 72727, NULL, NULL, NULL, NULL, NULL, '2026-06-01 00:00:00'),
  -- bx9 manual expense, office rent (residential - no GST)
  ('11111111-1111-4111-8111-111111110909', '11111111-1111-4111-8111-111111111010',
   'expense', 200000, 'AUD', '2026-05-01 00:00:00', 'Office rent', 'rent',
   NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, '2026-05-01 00:00:00'),
  -- bx10 income from Drive earning e2 (DoorDash)
  ('11111111-1111-4111-8111-111111110910', '11111111-1111-4111-8111-111111111010',
   'income', 8000, 'AUD', '2026-04-10 00:00:00', 'Drive earnings · DoorDash', 'gig',
   NULL, 'Auto-recorded from drive earnings (DoorDash).', 0,
   NULL, '11111111-1111-4111-8111-111111110402', NULL, NULL, NULL, '2026-04-10 00:00:00');

-- ----------------------------------------------------------------------------
-- 12. Receipt extractions - pending / reviewed / applied / rejected
-- ----------------------------------------------------------------------------
INSERT INTO receipt_extractions
  (id, workspace_id, file_id, status, extracted_data, transaction_id, error_message,
   model_used, actor_user_id, created_at, updated_at)
VALUES
  ('11111111-1111-4111-8111-111111110b01', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110a01', 'pending',
   '{"vendor":"Coles","total_cents":8420,"date":"2026-01-18","gst_cents":764}'::jsonb,
   NULL, NULL, 'claude-haiku-4-5', '11111111-1111-4111-8111-111111110001',
   '2026-01-18 00:00:00', '2026-01-18 00:00:00'),
  ('11111111-1111-4111-8111-111111110b02', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110a02', 'reviewed',
   '{"vendor":"Shell","total_cents":9000,"date":"2026-02-15","gst_cents":818}'::jsonb,
   NULL, NULL, 'claude-haiku-4-5', '11111111-1111-4111-8111-111111110001',
   '2026-02-15 00:00:00', '2026-02-16 00:00:00'),
  ('11111111-1111-4111-8111-111111110b03', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110a03', 'applied',
   '{"vendor":"Officeworks","total_cents":120000,"date":"2026-01-15","gst_cents":10909}'::jsonb,
   '11111111-1111-4111-8111-111111110906', NULL, 'claude-haiku-4-5',
   '11111111-1111-4111-8111-111111110001', '2026-01-15 00:00:00', '2026-01-16 00:00:00'),
  ('11111111-1111-4111-8111-111111110b04', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110a04', 'rejected',
   NULL, NULL, 'No receipt data found - image too blurry.', 'claude-haiku-4-5',
   '11111111-1111-4111-8111-111111110001', '2026-04-22 00:00:00', '2026-04-22 00:00:00');

-- ----------------------------------------------------------------------------
-- 14. Credit ledger - one row per entry_type (grant/consumption/refund/adjustment/
--     promotion/expired). Net balance = 500000 − 50000 + 20000 + 5000 + 100000 − 30000
--     = 545000. The 'expired' row's metadata.originalEntryId points at the promotion.
-- ----------------------------------------------------------------------------
INSERT INTO credit_ledger
  (id, workspace_id, entry_type, amount_cents, currency, reason, module_key,
   actor_user_id, stripe_invoice_id, stripe_refund_id, metadata, expires_at, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110c01', '11111111-1111-4111-8111-111111111010',
   'grant', 500000, 'AUD', 'Initial credit grant', NULL,
   '11111111-1111-4111-8111-111111110001', NULL, NULL, NULL, NULL, '2025-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110c02', '11111111-1111-4111-8111-111111111010',
   'consumption', -50000, 'AUD', 'Invoice send consumption', 'invoices',
   '11111111-1111-4111-8111-111111110001', 'in_seed_0002', NULL, NULL, NULL, '2026-06-16 00:00:00'),
  ('11111111-1111-4111-8111-111111110c03', '11111111-1111-4111-8111-111111111010',
   'refund', 20000, 'AUD', 'Refund for overcharge', NULL,
   '11111111-1111-4111-8111-111111110001', NULL, 're_seed_0003', NULL, NULL, '2026-06-10 00:00:00'),
  ('11111111-1111-4111-8111-111111110c04', '11111111-1111-4111-8111-111111111010',
   'adjustment', 5000, 'AUD', 'Manual balance adjustment', NULL,
   '11111111-1111-4111-8111-111111110003', NULL, NULL, NULL, NULL, '2026-05-15 00:00:00'),
  ('11111111-1111-4111-8111-111111110c05', '11111111-1111-4111-8111-111111111010',
   'promotion', 100000, 'AUD', 'Welcome promotional credit', NULL,
   '11111111-1111-4111-8111-111111110001', NULL, NULL, NULL, '2026-12-31 00:00:00', '2025-07-02 00:00:00'),
  ('11111111-1111-4111-8111-111111110c06', '11111111-1111-4111-8111-111111111010',
   'expired', -30000, 'AUD', 'Expired promotional credit', NULL,
   '11111111-1111-4111-8111-111111110001', NULL, NULL,
   '{"originalEntryId":"11111111-1111-4111-8111-111111110c05"}'::jsonb, NULL, '2026-01-01 00:00:00');

-- ----------------------------------------------------------------------------
-- 15. Tax periods - FY2025 quarters (Jul 2025–Jun 2026). Q1 lodged, Q2/Q3 not.
-- ----------------------------------------------------------------------------
INSERT INTO tax_periods
  (id, workspace_id, fiscal_year, quarter, period_label, gst_collected_cents,
   gst_paid_cents, net_gst_cents, lodged_at, lodged_by_user_id, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110d01', '11111111-1111-4111-8111-111111111010',
   2025, 1, 'FY2025 Q1', 50000, 12000, 38000, '2025-11-01 00:00:00',
   '11111111-1111-4111-8111-111111110003', '2025-11-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110d02', '11111111-1111-4111-8111-111111111010',
   2025, 2, 'FY2025 Q2', 80000, 15000, 65000, NULL, NULL, '2026-02-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110d03', '11111111-1111-4111-8111-111111111010',
   2025, 3, 'FY2025 Q3', 45000, 9000, 36000, NULL, NULL, '2026-05-01 00:00:00');

-- ----------------------------------------------------------------------------
-- 16. Activity events - spread over time for feed pagination
-- ----------------------------------------------------------------------------
INSERT INTO activity_events
  (id, workspace_id, actor_user_id, type, entity_type, entity_id, metadata, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110e01', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'workspace.create', 'workspace',
   '11111111-1111-4111-8111-111111111010', '{}'::jsonb, '2025-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110e02', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'customer.created', 'customer',
   '11111111-1111-4111-8111-111111110101', '{"name":"Acme Corp"}'::jsonb, '2025-07-05 00:00:00'),
  ('11111111-1111-4111-8111-111111110e03', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110002', 'module.enabled', 'module', 'books',
   '{"moduleKey":"books"}'::jsonb, '2025-07-02 00:00:00'),
  ('11111111-1111-4111-8111-111111110e04', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'invoice.created', 'invoice',
   '11111111-1111-4111-8111-111111110704', '{"number":"INV-2026-0004","totalCents":2530000}'::jsonb, '2026-05-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110e05', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'invoice.sent', 'invoice',
   '11111111-1111-4111-8111-111111110704', '{"number":"INV-2026-0004"}'::jsonb, '2026-05-02 00:00:00'),
  ('11111111-1111-4111-8111-111111110e06', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'invoice.paid', 'invoice',
   '11111111-1111-4111-8111-111111110704', '{"number":"INV-2026-0004","totalCents":2530000,"source":"manual"}'::jsonb, '2026-05-20 00:00:00'),
  ('11111111-1111-4111-8111-111111110e07', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'quote.accepted', 'quote',
   '11111111-1111-4111-8111-111111110804', '{"number":"QUO-2026-0004","totalCents":440000}'::jsonb, '2026-05-25 00:00:00'),
  ('11111111-1111-4111-8111-111111110e08', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'transaction.created', 'book_transaction',
   '11111111-1111-4111-8111-111111110905', '{"type":"income","category":"sales","amountCents":550000}'::jsonb, '2026-03-05 00:00:00'),
  ('11111111-1111-4111-8111-111111110e09', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'drive.earnings.logged', 'drive_earning',
   '11111111-1111-4111-8111-111111110401', '{"platform":"uber","amountCents":12050}'::jsonb, '2026-01-20 00:00:00'),
  ('11111111-1111-4111-8111-111111110e0a', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'member.invited', 'invitation',
   '11111111-1111-4111-8111-111111110901', '{"email":"pending@soletrade.test","role":"manager"}'::jsonb, '2026-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110e0b', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'credit.issued', 'credit_ledger',
   '11111111-1111-4111-8111-111111110c01', '{"amountCents":500000,"reason":"Initial credit grant"}'::jsonb, '2025-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110e0c', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'quote.converted', 'quote',
   '11111111-1111-4111-8111-111111110807', '{"number":"QUO-2026-0007","invoiceNumber":"INV-2026-0004"}'::jsonb, '2026-05-12 00:00:00');

-- ----------------------------------------------------------------------------
-- 17. Audit logs - create/update/delete actions across entities
-- ----------------------------------------------------------------------------
INSERT INTO audit_logs
  (id, workspace_id, actor_user_id, action, target_type, target_id, metadata, ip, created_at)
VALUES
  ('11111111-1111-4111-8111-111111110f01', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'workspace.create', 'workspace',
   '11111111-1111-4111-8111-111111111010', '{"name":"Soletrade Demo Co"}'::jsonb, '127.0.0.1', '2025-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110f02', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'customer.create', 'customer',
   '11111111-1111-4111-8111-111111110101', '{"name":"Acme Corp"}'::jsonb, '127.0.0.1', '2025-07-05 00:00:00'),
  ('11111111-1111-4111-8111-111111110f03', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110002', 'customer.update', 'customer',
   '11111111-1111-4111-8111-111111110101', '{"fields":["notes"]}'::jsonb, '127.0.0.1', '2025-08-12 00:00:00'),
  ('11111111-1111-4111-8111-111111110f04', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'customer.delete', 'customer',
   '11111111-1111-4111-8111-111111110106', '{"name":"Gamma LLC"}'::jsonb, '127.0.0.1', '2025-12-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110f05', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'invoice.create', 'invoice',
   '11111111-1111-4111-8111-111111110704', '{"number":"INV-2026-0004"}'::jsonb, '127.0.0.1', '2026-05-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110f06', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'invoice.send', 'invoice',
   '11111111-1111-4111-8111-111111110704', '{"number":"INV-2026-0004"}'::jsonb, '127.0.0.1', '2026-05-02 00:00:00'),
  ('11111111-1111-4111-8111-111111110f07', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'invoice.void', 'invoice',
   '11111111-1111-4111-8111-111111110705', '{"number":"INV-2026-0005"}'::jsonb, '127.0.0.1', '2026-04-10 00:00:00'),
  ('11111111-1111-4111-8111-111111110f08', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'member.role_change', 'member',
   '11111111-1111-4111-8111-111111110002', '{"fromRole":"employee","toRole":"admin"}'::jsonb, '127.0.0.1', '2025-08-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110f09', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'credit.grant', 'credit_ledger',
   '11111111-1111-4111-8111-111111110c01', '{"amountCents":500000}'::jsonb, '127.0.0.1', '2025-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110f0a', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'module.enable', 'module', 'books',
   '{"moduleKey":"books"}'::jsonb, '127.0.0.1', '2025-07-02 00:00:00'),
  ('11111111-1111-4111-8111-111111110f0b', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110003', 'transaction.create', 'book_transaction',
   '11111111-1111-4111-8111-111111110908', '{"type":"income","category":"services"}'::jsonb, '127.0.0.1', '2026-06-01 00:00:00'),
  ('11111111-1111-4111-8111-111111110f0c', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'workspace.update', 'workspace',
   '11111111-1111-4111-8111-111111111010', '{"fields":["invoice_prefix"]}'::jsonb, '127.0.0.1', '2025-07-10 00:00:00');

-- ----------------------------------------------------------------------------
-- 18. Notifications - mix read/unread, targeted at owner + admin
-- ----------------------------------------------------------------------------
INSERT INTO notifications
  (id, workspace_id, user_id, type, title, body, entity_type, entity_id, read_at, created_at)
VALUES
  ('11111111-1111-4111-8111-111111111001', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'invoice.paid', 'Invoice INV-2026-0004 paid',
   'Acme Corp paid $25,300.00.', 'invoice',
   '11111111-1111-4111-8111-111111110704', '2026-05-20 02:00:00', '2026-05-20 00:00:00'),
  ('11111111-1111-4111-8111-111111111002', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'quote.accepted', 'Quote QUO-2026-0004 accepted',
   'Walk-in Customer accepted $4,400.00.', 'quote',
   '11111111-1111-4111-8111-111111110804', NULL, '2026-05-25 00:00:00'),
  ('11111111-1111-4111-8111-111111111003', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'member.invited', 'Member invited',
   'pending@soletrade.test was invited as manager.', 'invitation',
   '11111111-1111-4111-8111-111111110901', NULL, '2026-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111004', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'credit.issued', 'Credit issued',
   '500,000 credits granted (Initial credit grant).', 'credit_ledger',
   '11111111-1111-4111-8111-111111110c01', '2025-07-01 02:00:00', '2025-07-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111005', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'invoice.overdue', 'Invoice INV-2026-0006 overdue',
   'Beta Industries - $11,000.00 past due.', 'invoice',
   '11111111-1111-4111-8111-111111110706', NULL, '2026-04-01 00:00:00'),
  ('11111111-1111-4111-8111-111111111006', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110002', 'invoice.paid', 'Invoice INV-2026-0004 paid',
   'Acme Corp paid $25,300.00.', 'invoice',
   '11111111-1111-4111-8111-111111110704', NULL, '2026-05-20 00:00:00'),
  ('11111111-1111-4111-8111-111111111007', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110002', 'quote.accepted', 'Quote QUO-2026-0004 accepted',
   'Walk-in Customer accepted $4,400.00.', 'quote',
   '11111111-1111-4111-8111-111111110804', NULL, '2026-05-25 00:00:00'),
  ('11111111-1111-4111-8111-111111111008', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110002', 'quote.declined', 'Quote QUO-2026-0005 declined',
   'Beta Industries declined $55,000.00.', 'quote',
   '11111111-1111-4111-8111-111111110805', '2026-04-15 02:00:00', '2026-04-15 00:00:00');

-- ----------------------------------------------------------------------------
-- 19. AI conversation + messages (owner, write_enabled)
-- ----------------------------------------------------------------------------
INSERT INTO ai_conversations
  (id, workspace_id, user_id, title, write_enabled, created_at, updated_at)
VALUES
  ('11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111010',
   '11111111-1111-4111-8111-111111110001', 'Bookkeeping help', true,
   '2026-07-08 00:00:00', '2026-07-09 00:00:00');

INSERT INTO ai_messages
  (id, conversation_id, role, content, created_at)
VALUES
  ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111101',
   'user', 'How do I record a GST payment to the ATO?', '2026-07-08 00:00:00'),
  ('11111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111101',
   'assistant', 'A GST payment to the ATO is recorded as an expense transaction in Books with the "tax" category - it reduces your net GST position but is not itself a deductible business expense. Create it from Books → New transaction → type: expense, category: tax, dated the day you paid it.', '2026-07-08 00:00:01'),
  ('11111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111101',
   'user', 'What was my best income month this year?', '2026-07-09 00:00:00'),
  ('11111111-1111-4111-8111-111111111114', '11111111-1111-4111-8111-111111111101',
   'assistant', 'Your best income month so far in 2026 is May - driven by the $25,300 INV-2026-0004 invoice payment and $8,000 in consulting fees, for a combined income well above any other month. June is second, led by consulting fees.', '2026-07-09 00:00:01');

-- ----------------------------------------------------------------------------
-- 20. Processed webhook events (idempotency table demo)
-- ----------------------------------------------------------------------------
INSERT INTO processed_webhook_events (stripe_event_id, stripe_event_type, processed_at) VALUES
  ('evt_seed_0001', 'invoice.paid', '2026-05-20 00:00:00'),
  ('evt_seed_0002', 'customer.subscription.updated', '2026-06-01 00:00:00');

-- ----------------------------------------------------------------------------
-- 21. Admin users and role assignments
-- ----------------------------------------------------------------------------
INSERT INTO admin_users (id, email, full_name, is_active, created_at, updated_at) VALUES
  ('11111111-1111-4111-8111-111111110099', 'admin@soletrade.example', 'Soletrade Super Admin', true, now(), now())
ON CONFLICT (email) DO UPDATE SET is_active = true;

INSERT INTO admin_role_assignments (admin_user_id, role, created_at) VALUES
  ('11111111-1111-4111-8111-111111110099', 'super_admin', now())
ON CONFLICT (admin_user_id, role) DO NOTHING;
