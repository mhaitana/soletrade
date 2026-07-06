import { requireWorkspaceContext } from "@/platform/context";
import { getUser } from "@/platform/users";
import { AccountForm } from "./account-form";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const ctx = await requireWorkspaceContext();
  const user = await getUser(ctx.user.id);
  return <AccountForm initialEmail={ctx.user.email} initialFullName={user?.fullName ?? ""} />;
}
