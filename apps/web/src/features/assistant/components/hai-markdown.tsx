import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Small dependency-free markdown renderer for assistant chat replies. It only
 * ever produces React elements (never raw HTML), tolerates partial streaming
 * text, and renders unsupported or unsafe constructs as literal text.
 */

const LINK_CLASS = "text-primary underline underline-offset-2";
const WORD = /[\p{L}\p{N}]/u;

// ---------------------------------------------------------------- inline

function renderLink(label: ReactNode[], href: string, key: string): ReactNode {
  if (/^\/(?![/\\])/.test(href)) {
    return (
      <Link key={key} href={href} className={LINK_CLASS}>
        {label}
      </Link>
    );
  }
  if (/^https?:\/\//i.test(href)) {
    return (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        {label}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  if (/^mailto:/i.test(href)) {
    return (
      <a key={key} href={href} className={LINK_CLASS}>
        {label}
      </a>
    );
  }
  return <span key={key}>{label}</span>;
}

function findClose(text: string, from: number, delim: string): number {
  let at = text.indexOf(delim, from);
  while (at !== -1) {
    const single = delim.length === 1;
    const prev = text[at - 1];
    const next = text[at + delim.length];
    const ok =
      at > from &&
      prev !== " " &&
      !(single && (next === delim || prev === delim)) &&
      !(delim.startsWith("_") && next !== undefined && WORD.test(next));
    if (ok) return at;
    at = text.indexOf(delim, at + 1);
  }
  return -1;
}

function renderInline(text: string, keyPrefix = "i", inLink = false): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) out.push(buf);
    buf = "";
  };
  const key = () => `${keyPrefix}-${out.length}`;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push(
          <code key={key()} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {text.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    } else if (ch === "[" && !inLink) {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(i));
      if (m) {
        flush();
        const k = key();
        out.push(renderLink(renderInline(m[1]!, k, true), m[2]!, k));
        i += m[0].length;
        continue;
      }
    } else if (ch === "*" || ch === "_") {
      const prev = text[i - 1];
      const intraWord = ch === "_" && prev !== undefined && WORD.test(prev);
      const double = text[i + 1] === ch;
      const delim = double ? ch + ch : ch;
      const next = text[i + delim.length];
      if (!intraWord && next !== undefined && next !== " " && next !== "\n") {
        const end = findClose(text, i + delim.length, delim);
        if (end !== -1) {
          flush();
          const k = key();
          const kids = renderInline(text.slice(i + delim.length, end), k, inLink);
          out.push(
            double ? (
              <strong key={k} className="font-semibold">
                {kids}
              </strong>
            ) : (
              <em key={k}>{kids}</em>
            ),
          );
          i = end + delim.length;
          continue;
        }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

function renderLines(lines: string[], keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  lines.forEach((line, n) => {
    if (n > 0) out.push(<br key={`${keyPrefix}-br${n}`} />);
    out.push(...renderInline(line, `${keyPrefix}-${n}`));
  });
  return out;
}

// ---------------------------------------------------------------- blocks

type ListEntry = { indent: number; ordered: boolean; num: number; text: string };
type Align = "left" | "right" | "center" | null;

const FENCE = /^\s*```\s*([\w+-]*)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const NUMERIC = /^[(+-]?[$€£]?\s?\d[\d,]*(\.\d+)?%?\)?$|^[(+-]?[$€£]?\s?\.\d+%?\)?$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function parseSeparator(line: string): Align[] | null {
  if (!line.includes("-") || !line.includes("|")) return null;
  const cells = splitRow(line);
  if (!cells.every((c) => /^:?-+:?$/.test(c))) return null;
  return cells.map((c) => {
    const l = c.startsWith(":");
    const r = c.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : null;
  });
}

function isBlockStart(line: string): boolean {
  return (
    FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line)
  );
}

function alignClass(align: Align, numeric: boolean): string {
  const a = align ?? (numeric ? "right" : "left");
  return cn(
    a === "right" && "text-right",
    a === "center" && "text-center",
    a === "left" && "text-left",
    numeric && "tabular-nums",
  );
}

function renderTable(header: string[], aligns: Align[], rows: string[][], k: string): ReactNode {
  return (
    <div key={k} className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {header.map((cell, c) => (
              <th
                key={c}
                scope="col"
                className={cn("px-2 py-1 font-semibold", alignClass(aligns[c] ?? null, false))}
              >
                {renderInline(cell, `${k}-h${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-border last:border-b-0">
              {header.map((_, c) => {
                const cell = row[c] ?? "";
                return (
                  <td
                    key={c}
                    className={cn("px-2 py-1", alignClass(aligns[c] ?? null, NUMERIC.test(cell)))}
                  >
                    {renderInline(cell, `${k}-${r}-${c}`)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderList(entries: ListEntry[], k: string, nested = false): ReactNode {
  const ordered = entries[0]!.ordered;
  const Tag = ordered ? "ol" : "ul";
  const items: { head: ListEntry; kids: ListEntry[] }[] = [];
  const base = Math.min(...entries.map((e) => e.indent));
  for (const e of entries) {
    const last = items[items.length - 1];
    if (nested || e.indent < base + 2 || !last) items.push({ head: e, kids: [] });
    else last.kids.push(e);
  }
  return (
    <Tag
      key={k}
      start={ordered && entries[0]!.num !== 1 ? entries[0]!.num : undefined}
      className={cn(ordered ? "list-decimal" : "list-disc", "space-y-1 pl-5", nested && "mt-1")}
    >
      {items.map((it, n) => (
        <li key={n}>
          {renderInline(it.head.text, `${k}-${n}`)}
          {it.kids.length > 0 && renderList(it.kids, `${k}-${n}-sub`, true)}
        </li>
      ))}
    </Tag>
  );
}

function parseEntry(line: string): ListEntry | null {
  const m = LIST.exec(line);
  if (!m) return null;
  const marker = m[2]!;
  const ordered = /\d/.test(marker);
  return {
    indent: m[1]!.replace(/\t/g, "  ").length,
    ordered,
    num: ordered ? parseInt(marker, 10) : 0,
    text: m[3]!,
  };
}

function renderBlocks(source: string, keyPrefix: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const k = `${keyPrefix}${out.length}`;

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      i += 1; // closing fence (or end of streaming input)
      out.push(
        <pre key={k} className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
          <code data-language={fence[1] || undefined}>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push(
        <p key={k} className="font-semibold text-foreground">
          {renderInline(heading[1]!.replace(/\s+#+\s*$/, ""), k)}
        </p>,
      );
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      out.push(<hr key={k} className="border-border" />);
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) inner.push(QUOTE.exec(lines[i++]!)![1]!);
      out.push(
        <blockquote
          key={k}
          className="space-y-2 border-l-2 border-border pl-3 text-muted-foreground"
        >
          {renderBlocks(inner.join("\n"), `${k}q`)}
        </blockquote>,
      );
      continue;
    }

    const aligns =
      line.includes("|") && i + 1 < lines.length ? parseSeparator(lines[i + 1]!) : null;
    if (aligns && splitRow(line).length === aligns.length) {
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() !== "" && lines[i]!.includes("|")) {
        rows.push(splitRow(lines[i++]!));
      }
      out.push(renderTable(splitRow(line), aligns, rows, k));
      continue;
    }

    const first = parseEntry(line);
    if (first) {
      const entries: ListEntry[] = [first];
      i += 1;
      while (i < lines.length) {
        const e = parseEntry(lines[i]!);
        if (!e || HR.test(lines[i]!)) break;
        const top = entries.filter((x) => x.indent < first.indent + 2);
        if (e.indent < first.indent + 2 && e.ordered !== top[0]!.ordered) break;
        entries.push(e);
        i += 1;
      }
      out.push(renderList(entries, k));
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      (para.length === 0 || !isBlockStart(lines[i]!))
    ) {
      para.push(lines[i++]!.trim());
    }
    out.push(<p key={k}>{renderLines(para, k)}</p>);
  }
  return out;
}

export function HaiMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-2 break-words text-foreground", className)}>
      {renderBlocks(text, "b")}
    </div>
  );
}
