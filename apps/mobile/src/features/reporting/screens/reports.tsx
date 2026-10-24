import { Action, Copy, ErrorNotice, Field, Group, Screen } from "@/components/ui";
import { periodDates } from "@/lib/periods";
import { useWorkspacePath } from "@/lib/resources";
import { useSession } from "@/lib/session";
import { shareBinary } from "@/lib/sharing";
import { useState } from "react";

export function ReportsScreen() {
  const { bootstrap } = useSession();
  const base = useWorkspacePath("books");
  const [from, setFrom] = useState(
    periodDates(
      "year",
      Number(bootstrap?.activeWorkspace?.settings.fyStartMonth ?? 7),
    ).dateFrom!.slice(0, 10),
  );
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async (type: "report" | "export") => {
    if (!base) return;
    setBusy(true);
    setError("");
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
        throw new Error("Choose a valid date range.");
      await shareBinary(
        `${base}/${type}?dateFrom=${from}T00:00:00.000Z&dateTo=${to}T23:59:59.999Z`,
        type === "report" ? "books-report.pdf" : "books-transactions.csv",
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Copy variant="title">Books reports</Copy>
      <Group>
        <Field label="From date" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" />
        <Field label="To date" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" />
      </Group>
      {error && <ErrorNotice message={error} />}
      <Action title="Share PDF report" busy={busy} onPress={() => void download("report")} />
      <Action
        title="Export transactions CSV"
        secondary
        busy={busy}
        onPress={() => void download("export")}
      />
    </Screen>
  );
}
