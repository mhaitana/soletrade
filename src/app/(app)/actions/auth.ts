"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/shared/lib/supabase/server";

/** Sign the current user out and redirect to /login. */
export async function signOutAction(): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
