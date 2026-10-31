"use client";

import { UserButton } from "@clerk/nextjs";

export function UserMenu({ enabled }: { enabled: boolean }) {
  if (!enabled) return <span className="text-xs text-amber-700">modo dev (sem Clerk)</span>;
  return <UserButton />;
}
