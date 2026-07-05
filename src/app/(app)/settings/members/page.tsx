import { loadMembersPage } from "@/app/(app)/actions/members";
import { MembersManager } from "./members-manager";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const data = await loadMembersPage();
  return <MembersManager initial={data} />;
}
