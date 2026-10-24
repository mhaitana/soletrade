import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageHref } from "@/utils/pagination";

export function ListPagination({
  pathname,
  page,
  hasNext,
  filters,
}: {
  pathname: string;
  page: number;
  hasNext: boolean;
  filters?: { status?: string | null; search?: string };
}) {
  if (page === 1 && !hasNext) return null;

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Page <span className="font-mono tabular-nums">{page}</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button asChild variant="outline">
            <Link href={pageHref(pathname, page - 1, filters)} rel="prev">
              <ChevronLeft className="size-4" aria-hidden />
              Previous
            </Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            <ChevronLeft className="size-4" aria-hidden />
            Previous
          </Button>
        )}
        {hasNext ? (
          <Button asChild variant="outline">
            <Link href={pageHref(pathname, page + 1, filters)} rel="next">
              Next
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            Next
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </nav>
  );
}
