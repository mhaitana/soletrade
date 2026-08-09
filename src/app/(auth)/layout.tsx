export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-start justify-center px-3 py-4 sm:px-4 sm:py-8 lg:items-center lg:py-12">
      <div className="w-full min-w-0">{children}</div>
    </div>
  );
}
