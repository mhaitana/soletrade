import { SummaryView } from "@/components/trends";
import { Choice, ErrorNotice, Loading, usePullRefresh } from "@/components/ui";
import { periodDates, periodOptions } from "@/lib/periods";
import { useResource, useWorkspacePath } from "@/lib/resources";
import { useSession } from "@/lib/session";
import { useState } from "react";

export function ModuleSummary({ module }: { module: "books" | "drive" }) {
  const { bootstrap } = useSession();
  const [period, setPeriod] = useState("year");
  const [asOf, setAsOf] = useState(() => new Date());
  const base = useWorkspacePath(`${module}/summary`);
  const dates = periodDates(
    period,
    Number(bootstrap?.activeWorkspace?.settings.fyStartMonth ?? 7),
    asOf,
  );
  const query = new URLSearchParams(
    Object.entries(dates).filter(([, value]) => value !== undefined) as [string, string][],
  );
  const state = useResource<Record<string, unknown>>(base ? `${base}?${query}` : null);
  const reload = () => {
    const nextAsOf = new Date();
    if (period === "all" || nextAsOf.getTime() === asOf.getTime()) void state.refresh();
    else setAsOf(nextAsOf);
  };
  usePullRefresh(reload);
  return (
    <>
      <Choice
        label="Summary period"
        value={period}
        options={periodOptions}
        onChange={(value) => {
          setAsOf(new Date());
          setPeriod(value);
        }}
      />
      {state.loading && !state.data ? (
        <Loading />
      ) : state.data ? (
        <SummaryView
          summary={state.data}
          currency={String(bootstrap?.activeWorkspace?.settings.defaultCurrency ?? "AUD")}
        />
      ) : null}
      {state.error && <ErrorNotice message={state.error} retry={reload} />}
    </>
  );
}
