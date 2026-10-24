import { Redirect, useLocalSearchParams } from "expo-router";
export default function CreateRoute() {
  const { resource } = useLocalSearchParams<{ resource?: string }>();
  const allowed = [
    "customers",
    "invoices",
    "quotes",
    "books/transactions",
    "drive/earnings",
    "drive/trips",
    "drive/vehicles",
    "drive/expenses",
  ];
  return (
    <Redirect
      href={{
        pathname: "/edit/[resource]/[id]",
        params: { resource: allowed.includes(resource ?? "") ? resource! : "invoices", id: "new" },
      }}
    />
  );
}
