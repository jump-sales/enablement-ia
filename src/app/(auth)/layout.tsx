import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <div className="rounded-lg border border-line bg-white p-6 shadow-sm">{children}</div>
        <p className="mt-6 text-center text-xs text-muted">
          As conversas são tratadas conforme a LGPD e nunca são usadas para treinar modelos de terceiros.
        </p>
      </div>
    </main>
  );
}
