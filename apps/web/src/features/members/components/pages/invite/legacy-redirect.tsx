import { notFound, redirect } from "next/navigation";

export const metadata = { title: "Invitation", robots: { index: false, follow: false } };

/**
 * Invitation emails sent before the link was corrected point at `/invite?token=...`, but the
 * accept page lives at `/invite/[token]`. Forward those links so invitations already in
 * people's inboxes keep working. No lookup happens here; the accept page validates the token.
 */
export default async function LegacyInviteRedirect({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const value = (Array.isArray(token) ? token[0] : token)?.trim();
  if (!value) notFound();
  redirect(`/invite/${encodeURIComponent(value)}`);
}
