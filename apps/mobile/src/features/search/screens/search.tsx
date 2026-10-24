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
import { useState } from "react";

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const base = useWorkspacePath("search");
  const state = useResource<{
    groups: { module: string; results: { id: string; label: string; href: string }[] }[];
  }>(query.trim().length >= 2 && base ? `${base}?q=${encodeURIComponent(query.trim())}` : null);
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
      {query.trim().length < 2 ? (
        <Copy muted>Enter at least two characters.</Copy>
      ) : state.loading && !state.data ? (
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
