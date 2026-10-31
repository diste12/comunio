import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Comunio", template: "%s · Comunio" },
  description: "Administração de condomínios automatizada.",
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout({ children }: LayoutProps<"/">) {
  const body = (
    <html lang="pt-PT" className="h-full">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
  return clerkConfigured ? <ClerkProvider>{body}</ClerkProvider> : body;
}
