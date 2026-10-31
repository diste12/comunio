import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
        <SignIn />
      ) : (
        <p className="text-stone-600">Autenticação não configurada (defina as chaves Clerk).</p>
      )}
    </main>
  );
}
