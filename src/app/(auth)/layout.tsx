export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full">{children}</div>
    </div>
  );
}
