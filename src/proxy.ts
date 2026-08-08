import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/shared/lib/env";

/**
 * Next.js 16 "proxy" (formerly `middleware.ts`, renamed in Next 16). In v16
 * Proxy defaults to the Node.js runtime (the `runtime` config key is NOT allowed
 * here and will throw). Refreshes the Supabase auth session cookie on every
 * matched request and redirects unauthenticated users away from protected
 * (app)-group routes.
 *
 * Public prefixes: marketing (/), /login, /signup, /pricing, the legal/support pages
 * (/privacy, /terms, /support), the auth email-link callback (/auth/), public
 * invoice/quote share pages (/i/, /q/), the invitation accept page (/invite/ -
 * handles signed-out first-time invitees), and /api/. Everything else requires a
 * session.
 */

const PUBLIC_PREFIXES = [
  "/",
  "/login",
  "/signup",
  "/auth",
  "/pricing",
  "/privacy",
  "/terms",
  "/support",
  "/offline",
  "/sw.js",
  "/i/",
  "/q/",
  "/invite/",
  "/api",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => (p === "/" ? pathname === "/" : pathname.startsWith(p)));
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured (local dev without auth), pass through. The
  // (app) layout's `requireUser` will throw a clear boundary error instead.
  if (!url || !anonKey) {
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresh the session (and its cookies, written onto `response` above).
  // Verify the access token from the request cookies. With Supabase's current
  // asymmetric signing keys this uses WebCrypto + the cached JWKS instead of a
  // network request to Auth on every navigation (getUser always makes one).
  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(claimsData?.claims.sub);

  const { pathname } = request.nextUrl;

  // Redirect unauthenticated users hitting a protected route to /login.
  if (!isAuthenticated && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from /login and /signup to /dashboard.
  if (isAuthenticated && (pathname === "/login" || pathname === "/signup")) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  // Match everything except static assets and Next internals. Proxy defaults
  // to the nodejs runtime in v16; do NOT add a `runtime` key here (it throws).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|css|js)$).*)",
  ],
};
