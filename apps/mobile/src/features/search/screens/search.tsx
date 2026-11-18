import {
  Copy,
  Empty,
  ErrorNotice,
  Field,
  Group,
  Loading,
  Row,
  Screen,
  human,
} from "@/components/ui";
import { navigateBusiness } from "@/lib/navigation/business";
import { useResource, useWorkspacePath } from "@/lib/resources";
import { useEffect, useState } from "react";

const SEARCH_DEBOUNCE_MS = 300;

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState("");
  const base = useWorkspacePath("search");
  const trimmed = query.trim();
  // Only the text the user has paused on is searched; useResource drops out-of-order responses.
  useEffect(() => {
    const timer = setTimeout(() => setSettled(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);
  const pending = settled !== trimmed;
  const state = useResource<{
    groups: { module: string; results: { id: string; label: string; href: string }[] }[];
  }>(settled.length >= 2 && base ? `${base}?q=${encodeURIComponent(settled)}` : null);
  return (
    <Screen>
      <Field
        label="Search customers, invoices, quotes and more"
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="none"
        returnKeyType="search"
      />
      {trimmed.length < 2 ? (
        <Copy muted>Enter at least two characters.</Copy>
      ) : pending || (state.loading && !state.data) ? (
        <Loading />
      ) : state.data?.groups.length ? (
        state.data.groups.map((group) => (
          <Group key={group.module} title={human(group.module)}>
            {group.results.map((result) => (
              <Row
                key={result.id}
                title={result.label}
                trailing="›"
                onPress={() => navigateBusiness(result.href)}
              />
            ))}
          </Group>
        ))
      ) : !state.error ? (
        <Empty title="No results" detail="Try a customer name, document number or description." />
      ) : null}
      {state.error && <ErrorNotice message={state.error} retry={() => void state.refresh()} />}
    </Screen>
  );
}
