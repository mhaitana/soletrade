import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { getUser } from "@/server/foundation/users/index";
import { AccountForm } from "@/features/account/components/account-form";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const ctx = await requireWorkspaceContext();
  const user = await getUser(ctx.user.id);
  return <AccountForm initialEmail={ctx.user.email} initialFullName={user?.fullName ?? ""} />;
}
