import Link from "next/link";
import { Suspense } from "react";
import { UserMenu } from "./_components/user-menu";

export const maxDuration = 600;

const NAV = [
  ["/admin", "Carteira"],
  ["/admin/tickets", "Ocorrências"],
  ["/admin/assemblies", "Assembleias"],
  ["/admin/banco", "Banco"],
  ["/admin/devedores", "Devedores"],
  ["/admin/whatsapp", "WhatsApp"],
  ["/admin/fornecedores", "Fornecedores"],
] as const;

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/admin" className="font-semibold text-brand-900">
              Comunio
            </Link>
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="text-stone-600 hover:text-stone-900">
                {label}
              </Link>
            ))}
          </nav>
          <Suspense fallback={null}>
            <UserMenu enabled={Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)} />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
