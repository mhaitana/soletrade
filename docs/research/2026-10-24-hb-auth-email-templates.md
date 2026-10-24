# Soletrade Supabase Auth email branding

Completed on 24 October 2026 for hosted Supabase project `oqzbzifuliwgfzogmorl` (Soletrade Workspace), organization `soletrade`, production `main` branch. The user explicitly included signup, sign-in, and password-reset Auth emails in the branding update.

## Changes

All six core Auth email bodies were saved through the authenticated Supabase dashboard. The matching formatted sources are in `supabase/templates/`.

The wrapper adds a 40 × 40 decorative HB PNG next to the visible Soletrade name, a stone background and white card, blue action buttons, and the footer “Soletrade is a product of Matt Haitana. © 2026 Matt Haitana”. It uses presentation tables, inline styles, and a conditional fixed-width MSO wrapper for Outlook. Original headings, sentences, action labels, expiry/single-use copy, and ignore-request advice are preserved.

| Hosted template | Subject before and after | Original body macros, preserved | Save + reload + source/preview verification |
| --- | --- | --- | --- |
| Confirm sign up | `Confirm your email address` | `{{ .ConfirmationURL }}` | Passed |
| Invite user | `You've been invited` | `{{ .ConfirmationURL }}` | Passed |
| Magic link or OTP | `Your sign-in link` | `{{ .ConfirmationURL }}` | Passed |
| Change email address | `Confirm your new email address` | `{{ .NewEmail }}`, `{{ .ConfirmationURL }}` | Passed |
| Reset password | `Reset your password` | `{{ .ConfirmationURL }}` | Passed |
| Reauthentication | `{{ .Token }} is your verification code` | `{{ .Token }}` | Passed |

The existing magic-link body contained a sign-in link, with no OTP display or conditions. Its behavior was preserved. Reauthentication still contains its original OTP in both the subject and body. No original body contained a conditional block.

## Hosted verification

Before editing, each subject and body was read from the correct Work Chrome profile and project. The formatted local HTML was pasted as the complete source, previewed, and saved. For each template, the Save button became disabled, the browser page was fully reloaded, and the persisted subject was checked against the captured original.

After reload, the source editor’s Find control located each original macro exactly once in the body. The `ConfirmationURL` occurrences remained in the action link’s `href`; `NewEmail` and `Token` remained in their original purpose copy. The persisted preview showed a single product header, the original purpose/security text and action, and the parent-brand footer. All six persisted sources were also searched for the exact full public PNG URL:

`https://business.soletrade.example/icons/soletrade-v1/icon-192x192.png`

The Monaco accessibility view exposes cursor-adjacent source fragments and elides the middle of a whole-document selection. Verification therefore checked persisted subjects, source macros and image URL, and rendered content after reload; it did not claim a byte-for-byte reread of each entire hosted body.

## Image preview limitation

The HB image appeared broken inside the Supabase dashboard preview, including after a fresh preview toggle. The persisted source contains the exact intended public URL in all six templates. The release task independently verified that URL returned HTTP 200 with a valid 192px PNG, and loaded the same image in the synthetic email previews.

Primary evidence supports a preview-policy explanation: the public Supabase dashboard response has a Content Security Policy `img-src` allowlist that excludes `business.soletrade.example`, and Supabase’s public `TemplateEditor.tsx` renders the preview in a `srcDoc` iframe. The image being blocked by the dashboard policy is an inference from those sources; the authenticated preview’s actual network rejection was not inspected. This is not evidence of an inbox delivery or rendering failure. The captured evidence is `/private/tmp/soletrade-supabase-public-headers.txt` and `/private/tmp/soletrade-supabase-TemplateEditor.tsx`.

No email was sent, no user was created, and no authentication action or real token was exercised. The preview leaves Go template macros literal. Inbox delivery/rendering was not tested.

## Preserved settings

SMTP fields and the existing sender `Soletrade <support@soletrade.example>` were not edited. Auth URLs, providers, security policies, and enable flags were not changed. The seven optional security-notification switches were observed off before this work; those templates and switches were not edited.

## Local verification artifacts

Artifacts were saved outside the repository under `/private/tmp/hb-auth-email-templates/`:

- `originals.json`: captured original subjects and body HTML.
- `verified.json`: per-template persisted-verification results.
- `*-persisted.png`: screenshots of persisted dashboard previews.
- `*-persisted-ax.txt`: persisted preview accessibility snapshots where captured.
- `reauthentication-persisted.png`: representative proof showing the correct project/org, unchanged token subject, Soletrade product name, and full Matt Haitana footer. It also records the image-preview limitation.

All six source files were formatted with Prettier before the final hosted paste. The overall release task separately checked these sources in synthetic mobile email previews; that check is distinct from hosted persistence and actual email delivery.

Reference: [Supabase Auth email template documentation](https://supabase.com/docs/guides/auth/auth-email-templates).
