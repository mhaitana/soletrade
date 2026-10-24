import { Action, Choice, Copy, ErrorNotice, Field, Loading } from "@/components/ui";
import { useResource, useWorkspacePath, type Entity } from "@/lib/resources";
import type { CollectionPage } from "@soletrade/contracts";
import { useEffect, useState } from "react";

export function ReferenceField({
  label,
  resource,
  value,
  onChange,
  excludeIds = [],
}: {
  label: string;
  resource: string;
  value: string;
  onChange: (value: string) => void;
  excludeIds?: string[];
}) {
  const path = useWorkspacePath(resource);
  const [cursor, setCursor] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Entity[]>([]);
  const state = useResource<CollectionPage<Entity>>(
    path ? `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}` : null,
  );
  const selected = useResource<Entity>(
    value && path && !rows.some((row) => (resource === "members" ? row.userId : row.id) === value)
      ? `${path}/${encodeURIComponent(value)}`
      : null,
  );
  useEffect(() => {
    if (!state.data) return;
    const incoming = state.data.items;
    // Keep preceding pages available while the next reference page loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows((previous) => {
      const combined = cursor ? [...previous, ...incoming] : incoming;
      return combined.filter(
        (row, index) =>
          combined.findIndex(
            (other) =>
              (resource === "members" ? other.userId : other.id) ===
              (resource === "members" ? row.userId : row.id),
          ) === index,
      );
    });
  }, [state.data, cursor, resource]);
  const options = [
    ...rows,
    ...(selected.data && typeof selected.data === "object" && !("items" in selected.data)
      ? [selected.data]
      : []),
  ]
    .map((entity) => ({
      label: String(
        entity.name ??
          entity.fullName ??
          entity.email ??
          entity.description ??
          entity.number ??
          entity.id ??
          entity.userId ??
          "",
      ),
      value: String((resource === "members" ? entity.userId : entity.id) ?? ""),
    }))
    .filter(
      (option) =>
        option.value &&
        !excludeIds.includes(option.value) &&
        (!search.trim() ||
          option.value === value ||
          option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),
    )
    .filter(
      (option, index, array) => array.findIndex((other) => other.value === option.value) === index,
    );
  if (state.denied)
    return <ErrorNotice message={state.error ?? "These choices are no longer available."} />;
  return (
    <>
      <Field
        label={`Search ${label.toLowerCase().replace(/\s*\*$/, "")}`}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
      />
      <Copy variant="caption" muted>
        Search loaded choices. Load more to include the next page.
      </Copy>
      <Choice
        label={label}
        value={value}
        onChange={onChange}
        options={[{ label: "None", value: "" }, ...options]}
      />
      {state.loading && <Loading />}
      {state.data?.nextCursor && (
        <Action
          title={`Load more ${resource === "members" ? "team members" : resource.split("/").pop()}`}
          secondary
          busy={state.loading}
          onPress={() => setCursor(state.data!.nextCursor!)}
        />
      )}
      {state.error && <ErrorNotice message={state.error} retry={() => void state.refresh()} />}
    </>
  );
}
