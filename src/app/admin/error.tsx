"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} />;
}
