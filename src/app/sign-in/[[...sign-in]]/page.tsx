import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
        // Clerk reads the URL (usePathname); with Cache Components that must stream behind Suspense.
        <Suspense fallback={<p className="text-sm text-stone-500">A carregar…</p>}>
          <SignIn />
        </Suspense>
      ) : (
        <p className="text-stone-600">Autenticação não configurada (defina as chaves Clerk).</p>
      )}
    </main>
  );
}
