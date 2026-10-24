import Link from "next/link";
import { Logo } from "@/shared/components/logo";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { Button } from "@/shared/ui/button";
import { brand } from "@/config/brand";
import { urls } from "@/config/urls";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:px-8">
        <div className="hidden sm:block">
          <Logo />
        </div>
        <div className="hidden min-[360px]:block sm:hidden">
          <Logo variant="compact" />
        </div>
        <div className="min-[360px]:hidden">
          <Logo variant="mark" />
        </div>
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/pricing">Pricing</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/dashboard">Open app</Link>
          </Button>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border px-4 py-8 md:px-8">
        <div className="flex w-full flex-wrap items-center justify-between gap-4">
          <Logo variant="full" />
          <nav className="flex flex-wrap items-center text-sm text-muted-foreground">
            <Link href={urls.privacy} className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <span aria-hidden className="px-2 text-muted-foreground/40">
              ·
            </span>
            <Link href={urls.terms} className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <span aria-hidden className="px-2 text-muted-foreground/40">
              ·
            </span>
            <Link href={urls.support} className="transition-colors hover:text-foreground">
              Support
            </Link>
          </nav>
        </div>
        <p className="mt-4 w-full text-xs text-muted-foreground/80">
          © {new Date().getFullYear()} {brand.companyName}
        </p>
      </footer>
    </div>
  );
}
