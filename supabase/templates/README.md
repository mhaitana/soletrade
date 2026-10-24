# Supabase Auth email templates

These are the Soletrade HTML bodies saved to the hosted Supabase Auth email templates for project `oqzbzifuliwgfzogmorl` (Soletrade Workspace).

| Dashboard template | HTML body | Existing subject, preserved |
| --- | --- | --- |
| Confirm sign up | `confirm-sign-up.html` | `Confirm your email address` |
| Invite user | `invite-user.html` | `You've been invited` |
| Magic link or OTP | `magic-link-or-otp.html` | `Your sign-in link` |
| Change email address | `change-email-address.html` | `Confirm your new email address` |
| Reset password | `reset-password.html` | `Reset your password` |
| Reauthentication | `reauthentication.html` | `{{ .Token }} is your verification code` |

To update a body, open the matching template under Authentication → Emails → Templates, select Source, replace the entire editor content with the corresponding HTML file, preview it, and save. Reload the page and verify the unchanged subject, purpose/security copy, macro, and branding. These files do not configure SMTP, auth URLs, policies, or notification enable flags, and are not wired into a full Supabase configuration push.

Keep the Go template macros intact. The dashboard preview displays them literally; it does not perform an authentication transaction. No test emails are required for a cosmetic template update.

See `docs/research/2026-10-24-hb-auth-email-templates.md` for the hosted verification record and preview limitation.
