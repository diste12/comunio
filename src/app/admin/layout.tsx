import Link from "next/link";
import { UserMenu } from "./_components/user-menu";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/admin" className="font-semibold text-brand-900">
              Comunio
            </Link>
            <Link href="/admin" className="text-stone-600 hover:text-stone-900">
              Carteira
            </Link>
          </nav>
          <UserMenu enabled={Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
