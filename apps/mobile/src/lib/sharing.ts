import { authenticatedFetch } from "@/lib/api";
import { token } from "@/lib/session";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function shareBinary(path: string, name: string) {
  const response = await authenticatedFetch(path, await token());
  if (!response.ok) throw new Error(`Could not prepare file (${response.status}).`);
  const file = new File(Paths.cache, name);
  await file.write(new Uint8Array(await response.arrayBuffer()));
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(file.uri, {
      mimeType: name.endsWith(".pdf") ? "application/pdf" : "text/csv",
    });
  else throw new Error("Sharing is unavailable on this device.");
}
