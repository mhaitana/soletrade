import { describe, expect, it } from "vitest";
import { toCsv, type CsvColumn } from "@/utils/csv";

const COLS: readonly CsvColumn[] = [
  { key: "name", header: "Name" },
  { key: "amount", header: "Amount" },
  { key: "note", header: "Note" },
];

describe("shared csv - toCsv", () => {
  it("emits a header row from columns even when there are no data rows", () => {
    expect(toCsv([], COLS)).toBe("Name,Amount,Note");
  });

  it("serialises a simple row with no quoting", () => {
    const csv = toCsv([{ name: "Alice", amount: 12.5, note: "hi" }], COLS);
    expect(csv).toBe("Name,Amount,Note\r\nAlice,12.5,hi");
  });

  it("quotes fields containing a comma", () => {
    const csv = toCsv([{ name: "Smith, John", amount: 0, note: "" }], COLS);
    expect(csv).toBe('Name,Amount,Note\r\n"Smith, John",0,');
  });

  it("escapes embedded double-quotes by doubling them", () => {
    const csv = toCsv([{ name: 'Say "hi"', amount: 0, note: "" }], COLS);
    expect(csv).toBe('Name,Amount,Note\r\n"Say ""hi""",0,');
  });

  it("quotes fields containing a newline", () => {
    const csv = toCsv([{ name: "line1\nline2", amount: 0, note: "" }], COLS);
    expect(csv).toBe('Name,Amount,Note\r\n"line1\nline2",0,');
  });

  it("serialises Date values as ISO strings", () => {
    const d = new Date("2026-07-05T10:30:00Z");
    const csv = toCsv([{ name: "x", amount: 0, note: d }], COLS);
    expect(csv).toBe(`Name,Amount,Note\r\nx,0,${d.toISOString()}`);
  });

  it("renders null + undefined as empty cells", () => {
    const csv = toCsv([{ name: null, amount: undefined, note: "" }], COLS);
    expect(csv).toBe("Name,Amount,Note\r\n,,");
  });

  it("emits rows in the given order and only reads declared columns", () => {
    const csv = toCsv(
      [
        { name: "A", amount: 1, note: "first", extra: "ignored" },
        { name: "B", amount: 2, note: "second", extra: "ignored" },
      ],
      COLS,
    );
    expect(csv).toBe("Name,Amount,Note\r\nA,1,first\r\nB,2,second");
  });
});
