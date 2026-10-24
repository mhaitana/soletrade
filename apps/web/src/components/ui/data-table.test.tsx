import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable, type Column } from "@/components/ui/data-table";

type Row = { id: string; name: string; amount: number };

describe("shared <DataTable>", () => {
  it("renders headers and rows, aligning numeric columns as mono", () => {
    const columns: Column<Row>[] = [
      { header: "Name", cell: (r) => r.name },
      {
        header: "Amount",
        cell: (r) => `$${r.amount.toFixed(2)}`,
        numeric: true,
      },
    ];
    const rows: Row[] = [
      { id: "1", name: "Alpha", amount: 12.5 },
      { id: "2", name: "Beta", amount: 100 },
    ];

    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);

    // Columnheaders are scoped <th>.
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Amount" })).toBeTruthy();

    // Two rows + the header row.
    expect(screen.getAllByRole("row")).toHaveLength(3);

    const cells = screen.getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["Alpha", "$12.50", "Beta", "$100.00"]);

    // The numeric header + numeric cells get the mono class.
    const amountHeader = screen.getByRole("columnheader", { name: "Amount" });
    expect(amountHeader.className).toContain("font-mono");
    const amountCell = cells.find((c) => c.textContent === "$12.50");
    expect(amountCell?.className).toContain("font-mono");
    expect(amountCell?.className).toContain("text-right");
  });

  it("renders the empty state instead of a table when there are no rows", () => {
    const columns: Column<Row>[] = [{ header: "Name", cell: (r) => r.name }];
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyState={<p>No invoices yet.</p>}
      />,
    );
    expect(screen.getByText("No invoices yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
