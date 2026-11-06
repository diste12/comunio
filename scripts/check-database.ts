/** Read-only smoke test: safe against a configured database; never migrates or seeds. */
import { sql } from "@/lib/db";
import { portfolioTotals, listCondominiums } from "@/lib/services/ledger";
import { approvalsQueue } from "@/lib/services/approvals";

async function main() {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([portfolioTotals(), listCondominiums({}), approvalsQueue()]),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Dashboard reads exceeded 10 seconds")), 10_000);
      }),
    ]);
    console.log(`PASS: dashboard queries completed in ${Date.now() - started} ms`);
  } catch (error) {
    // Do not print connection strings, query parameters, or residents' data.
    console.error("FAIL: dashboard queries failed or timed out", (error as { code?: string }).code ?? "");
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await sql.end({ timeout: 1 });
  }
}

void main();
