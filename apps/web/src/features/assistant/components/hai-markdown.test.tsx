import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HaiMarkdown } from "@/features/assistant/components/hai-markdown";

function view(text: string) {
  return render(<HaiMarkdown text={text} />);
}

describe("HaiMarkdown", () => {
  it("renders paragraphs and single newlines as line breaks", () => {
    const { container } = view("first\nsecond\n\nthird");
    const paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(2);
    expect(paras[0]!.querySelectorAll("br")).toHaveLength(1);
    expect(paras[0]).toHaveTextContent("firstsecond");
  });

  it("renders headings as semibold paragraphs, never h1-h6", () => {
    const { container } = view("# One\n## Two\n###### Deep");
    expect(container.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    const paras = container.querySelectorAll("p.font-semibold");
    expect(paras).toHaveLength(3);
    expect(paras[2]).toHaveTextContent("Deep");
  });

  it("renders unordered lists with all marker types", () => {
    const { container } = view("- a\n* b\n+ c");
    const items = container.querySelectorAll("ul.list-disc > li");
    expect(Array.from(items).map((li) => li.textContent)).toEqual(["a", "b", "c"]);
  });

  it("renders ordered lists and keeps the start number", () => {
    const { container } = view("3) three\n4) four");
    const ol = container.querySelector("ol.list-decimal");
    expect(ol).toHaveAttribute("start", "3");
    expect(ol!.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders one level of nested lists", () => {
    const { container } = view("- parent\n  - child a\n  - child b\n- sibling");
    const top = container.querySelector("ul")!;
    expect(top.children).toHaveLength(2);
    expect(top.querySelectorAll("ul > li > ul > li")).toHaveLength(2);
    const nestedOrdered = view("1. a\n  - x").container.querySelector("ol > li > ul");
    expect(nestedOrdered).not.toBeNull();
  });

  it("renders fenced code blocks and keeps content literal", () => {
    const { container } = view("```ts\nconst a = **1**;\n<b>x</b>\n```\nafter");
    const code = container.querySelector("pre > code")!;
    expect(code.textContent).toBe("const a = **1**;\n<b>x</b>");
    expect(container.querySelector("pre")).toHaveClass("overflow-x-auto");
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("after")).toBeInTheDocument();
  });

  it("renders inline code, bold and italic", () => {
    const { container } = view("`x_y` **bold** __bold2__ *it* _it2_");
    expect(container.querySelector("code")).toHaveTextContent("x_y");
    expect(Array.from(container.querySelectorAll("strong")).map((e) => e.textContent)).toEqual([
      "bold",
      "bold2",
    ]);
    expect(Array.from(container.querySelectorAll("em")).map((e) => e.textContent)).toEqual([
      "it",
      "it2",
    ]);
  });

  it("keeps underscores inside words literal", () => {
    const { container } = view("see snake_case_names and file_name.txt now");
    expect(container.querySelector("em")).toBeNull();
    expect(container).toHaveTextContent("see snake_case_names and file_name.txt now");
  });

  it("renders internal links with next/link", () => {
    view("[Invoices](/invoices)");
    const link = screen.getByRole("link", { name: "Invoices" });
    expect(link).toHaveAttribute("href", "/invoices");
    expect(link).not.toHaveAttribute("target");
  });

  it("renders external links in a new tab with hidden hint", () => {
    const { container } = view("[Docs](https://example.com/a)");
    const a = container.querySelector("a")!;
    expect(a).toHaveAttribute("href", "https://example.com/a");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    const hint = a.querySelector("span.sr-only")!;
    expect(hint).toHaveTextContent("(opens in a new tab)");
  });

  it("renders mailto links as plain anchors", () => {
    const { container } = view("[Mail](mailto:a@b.co)");
    const a = container.querySelector("a")!;
    expect(a).toHaveAttribute("href", "mailto:a@b.co");
    expect(a).not.toHaveAttribute("target");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "vbscript:x", "relative/path", "//evil.com"])(
    "renders unsafe href %s as text only",
    (href) => {
      const { container } = view(`[click](${href})`);
      expect(container.querySelector("a")).toBeNull();
      expect(container).toHaveTextContent("click");
    },
  );

  it("does not auto-link bare URLs", () => {
    const { container } = view("visit https://example.com today");
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders tables with alignment, scope and numeric cells", () => {
    const { container } = view(
      "| Name | Qty | Note |\n|:--|--:|:-:|\n| Pens | 1,200 | ok |\n| Ink | $3.50 | x |",
    );
    expect(container.querySelector("div.overflow-x-auto > table")).not.toBeNull();
    const ths = container.querySelectorAll("th[scope='col']");
    expect(ths).toHaveLength(3);
    expect(ths[1]).toHaveClass("text-right");
    expect(ths[2]).toHaveClass("text-center");
    const cells = container.querySelectorAll("tbody tr:first-child td");
    expect(cells[0]).toHaveClass("text-left");
    expect(cells[1]).toHaveClass("text-right", "tabular-nums");
    expect(cells[2]).toHaveClass("text-center");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("right-aligns numeric cells by default", () => {
    const { container } = view("| a | b |\n|---|---|\n| x | 42 |");
    const cells = container.querySelectorAll("tbody td");
    expect(cells[0]).not.toHaveClass("tabular-nums");
    expect(cells[1]).toHaveClass("text-right", "tabular-nums");
  });

  it("treats a table without a separator row as a paragraph", () => {
    const { container } = view("| a | b |\n| 1 | 2 |");
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("p")).toHaveTextContent("| a | b || 1 | 2 |");
  });

  it("renders blockquotes and horizontal rules", () => {
    const { container } = view("> quoted **text**\n\n---\n\n***");
    expect(container.querySelector("blockquote strong")).toHaveTextContent("text");
    expect(container.querySelectorAll("hr")).toHaveLength(2);
  });

  it("renders raw HTML as literal text", () => {
    const { container } = view('<script>alert(1)</script>\n<img src=x onerror="alert(2)">');
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
    expect(container).toHaveTextContent('<img src=x onerror="alert(2)">');
  });

  it("copes with partial streaming input", () => {
    const fence = view("intro\n```js\nconst x = 1;");
    expect(fence.container.querySelector("pre > code")).toHaveTextContent("const x = 1;");

    expect(() => view("**bold but not clo")).not.toThrow();
    const bold = view("**unclosed bold");
    expect(bold.container.querySelector("strong")).toBeNull();
    expect(bold.container).toHaveTextContent("**unclosed bold");

    const tick = view("an `unclosed tick");
    expect(tick.container.querySelector("code")).toBeNull();
    expect(tick.container).toHaveTextContent("an `unclosed tick");

    for (const partial of [
      "[lab",
      "[lab](",
      "[lab](/x",
      "| a |\n|",
      "> ",
      "- ",
      "1.",
      "#",
      "*",
      "_",
      "",
    ]) {
      expect(() => view(partial)).not.toThrow();
    }
  });

  it("applies a custom className", () => {
    const { container } = render(<HaiMarkdown text="hi" className="extra" />);
    expect(container.firstElementChild).toHaveClass("extra");
  });
});
