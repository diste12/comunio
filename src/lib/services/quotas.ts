import "server-only";
import { sql } from "@/lib/db";
import { centsToDecimal } from "@/lib/money";
import { buildQuotaPlan, type BudgetInput, type QuotaPlan } from "@/lib/quotas/engine";

export class BudgetExistsError extends Error {}

async function loadFractions(condominiumId: string) {
  const rows = await sql<{ id: string; designation: string; permilagem: string }[]>`
    select id, designation, permilagem from fractions
    where condominium_id = ${condominiumId}
    order by designation`;
  return rows.map((r) => ({ id: r.id, designation: r.designation, permilagem: Number(r.permilagem) }));
}

/** Dry run: what the Permilagem Engine would charge, without writing anything. */
export async function previewQuotaPlan(condominiumId: string, budget: BudgetInput): Promise<QuotaPlan> {
  return buildQuotaPlan(await loadFractions(condominiumId), budget);
}

/**
 * Persist a budget and its quota charges for a fiscal year in one transaction.
 * A year can only be generated once; corrections go through a new budget flow
 * (cancel + regenerate), never silent rewrites of an issued ledger.
 */
export async function generateQuotas(condominiumId: string, budget: BudgetInput) {
  return sql.begin(async (tx) => {
    // Serialise generation per condominium.
    await tx`select id from condominiums where id = ${condominiumId} for update`;
    const [existing] = await tx`
      select id from budgets where condominium_id = ${condominiumId} and fiscal_year = ${budget.fiscalYear}`;
    if (existing) throw new BudgetExistsError(`Quotas for ${budget.fiscalYear} were already generated`);

    const fractions = await tx<{ id: string; designation: string; permilagem: string }[]>`
      select id, designation, permilagem from fractions where condominium_id = ${condominiumId} order by designation`;
    const plan = buildQuotaPlan(
      fractions.map((f) => ({ id: f.id, designation: f.designation, permilagem: Number(f.permilagem) })),
      budget,
    );

    const [row] = await tx<{ id: string }[]>`
      insert into budgets ${tx({
        condominium_id: condominiumId,
        fiscal_year: budget.fiscalYear,
        ordinary_amount: centsToDecimal(plan.totals.ordinaryCents),
        reserve_fund_pct: String(budget.reserveFundPct ?? 10),
        installments: budget.installments ?? 12,
        due_day: budget.dueDay ?? 8,
        reserve_amount: centsToDecimal(plan.totals.reserveCents),
      })}
      returning id`;

    const charges = plan.charges.map((c) => ({
      fraction_id: c.fractionId,
      condominium_id: condominiumId,
      budget_id: row.id,
      installment: c.installment,
      description: c.description,
      amount_ordinary: centsToDecimal(c.amountOrdinaryCents),
      amount_reserve: centsToDecimal(c.amountReserveCents),
      amount_total: centsToDecimal(c.amountTotalCents),
      due_date: c.dueDate,
    }));
    // Chunk to stay well below the 65k bind-parameter limit.
    for (let i = 0; i < charges.length; i += 1000) {
      await tx`insert into quota_charges ${tx(charges.slice(i, i + 1000))}`;
    }
    return { budgetId: row.id, plan };
  });
}
