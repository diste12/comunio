"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function PortalError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} setupLink={false} />;
}
