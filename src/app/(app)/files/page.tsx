import Link from "next/link";
import { loadFilesPage } from "./actions";
import { FilesTable } from "./files-table";
import { UploadButton } from "./upload-button";
import { branded } from "@/shared/types/ids";
import type { FileCursor } from "@/platform/files";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";

export const metadata = { title: "Files" };

const DEFAULT_LIMIT = 25;

/** Cursor is encoded as `<isoCreatedAt>|<id>` so it survives a GET round-trip. */
function encodeCursor(cursor: FileCursor): string {
  return `${cursor.createdAt.toISOString()}|${cursor.id}`;
}

function parseCursor(raw: string): FileCursor | null {
  const [iso, id] = raw.split("|");
  if (!iso || !id) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id: branded<"FileId">(id) };
}

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string | string[] }>;
}) {
  const sp = await searchParams;
  const beforeRaw = typeof sp.before === "string" ? sp.before : undefined;
  const before = beforeRaw ? (parseCursor(beforeRaw) ?? undefined) : undefined;

  const result = await loadFilesPage({ limit: DEFAULT_LIMIT, before });

  if (!result.access) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
          <p className="text-sm text-muted-foreground">
            Receipts and documents for this workspace.
          </p>
        </div>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              You don&apos;t have permission to view files. Ask a workspace owner or admin.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { items, nextCursor } = result.page;
  const loadMoreHref = nextCursor ? `/files?before=${encodeCursor(nextCursor)}` : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground">
          Receipts and documents. Bytes are stored in Supabase Storage; this page lists the
          metadata.
        </p>
      </div>

      {result.canManage ? <UploadButton /> : null}

      <FilesTable items={items} canManage={result.canManage} />

      {loadMoreHref ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={loadMoreHref}>Load more</Link>
          </Button>
        </div>
      ) : items.length > 0 ? (
        <p className="text-center text-xs text-muted-foreground">End of files.</p>
      ) : null}
    </div>
  );
}
