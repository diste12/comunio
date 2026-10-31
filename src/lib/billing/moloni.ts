import "server-only";
import { env } from "@/lib/env";
import type { BillingProvider, IssuedReceipt, ReceiptRequest } from "./types";

const API = "https://api.moloni.pt/v1";
/** Moloni's "consumidor final" NIF, used when the owner did not give a NIF. */
const FINAL_CONSUMER_NIF = "999999990";

type Token = { accessToken: string; expiresAt: number };
let token: Token | undefined;

/**
 * Moloni multi-company client: a single Moloni account owns one company per
 * condominium NIF; every call is scoped with `company_id`.
 *
 * TODO before go-live (needs Moloni sandbox access, unavailable during the sprint):
 *  - confirm the document type for "Recibo de Quitação" with the accountant
 *    (invoiceReceipts vs. receipts against a prior invoice) and the VAT
 *    exemption reason for condominium quotas;
 *  - map payment_method_id / maturity_date_id per company instead of first-found.
 */
export class MoloniProvider implements BillingProvider {
  readonly name = "moloni" as const;

  async issueReceipt(req: ReceiptRequest): Promise<IssuedReceipt> {
    if (!req.companyId || !req.documentSetId || !req.productId) {
      throw new Error("Condominium is missing Moloni company/document set/product configuration");
    }
    const companyId = req.companyId;
    const customerId = await this.ensureCustomer(companyId, req.customer);
    const date = req.paidAt.toISOString().slice(0, 10);
    const value = req.amountCents / 100;
    const [paymentMethodId] = await call<{ payment_method_id: number }[]>("paymentMethods/getAll", {
      company_id: companyId,
    }).then((r) => r.map((m) => m.payment_method_id));

    const inserted = await call<{ valid: number; document_id: number }>("invoiceReceipts/insert", {
      company_id: companyId,
      date,
      expiration_date: date,
      document_set_id: req.documentSetId,
      customer_id: customerId,
      our_reference: req.ourReference,
      products: [
        {
          product_id: req.productId,
          name: req.description,
          qty: 1,
          price: value,
          exemption_reason: "M99",
          taxes: [],
        },
      ],
      payments: [{ payment_method_id: paymentMethodId, date, value }],
      status: 1, // closed → certified and communicated to AT
    });
    if (!inserted.valid) throw new Error("Moloni rejected the document");

    const pdf = await call<{ url?: string }>("documents/getPDFLink", {
      company_id: companyId,
      document_id: inserted.document_id,
    }).catch(() => ({ url: undefined }));
    return { documentId: String(inserted.document_id), documentNumber: null, pdfUrl: pdf.url ?? null };
  }

  private async ensureCustomer(companyId: number, c: ReceiptRequest["customer"]): Promise<number> {
    const vat = c.nif ?? FINAL_CONSUMER_NIF;
    if (vat !== FINAL_CONSUMER_NIF) {
      const found = await call<{ customer_id: number }[]>("customers/getByVat", { company_id: companyId, vat });
      if (found.length > 0) return found[0].customer_id;
    } else {
      const found = await call<{ customer_id: number }[]>("customers/getBySearch", {
        company_id: companyId,
        search: c.name,
      });
      if (found.length > 0) return found[0].customer_id;
    }
    const next = await call<{ number: string }>("customers/getNextNumber", { company_id: companyId });
    const created = await call<{ valid: number; customer_id: number }>("customers/insert", {
      company_id: companyId,
      vat,
      number: next.number,
      name: c.name,
      email: c.email ?? "",
      language_id: 1,
      address: "",
      zip_code: "",
      city: "",
      country_id: 1,
      maturity_date_id: 0,
      payment_method_id: 0,
      salesman_id: 0,
      payment_day: 0,
      discount: 0,
      credit_limit: 0,
      delivery_method_id: 0,
    });
    return created.customer_id;
  }
}

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.accessToken;
  const e = env();
  if (!e.MOLONI_CLIENT_ID || !e.MOLONI_CLIENT_SECRET || !e.MOLONI_USERNAME || !e.MOLONI_PASSWORD) {
    throw new Error("Moloni credentials are not configured");
  }
  const params = new URLSearchParams({
    grant_type: "password",
    client_id: e.MOLONI_CLIENT_ID,
    client_secret: e.MOLONI_CLIENT_SECRET,
    username: e.MOLONI_USERNAME,
    password: e.MOLONI_PASSWORD,
  });
  const res = await fetch(`${API}/grant/?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Moloni auth HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.accessToken;
}

async function call<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const url = `${API}/${endpoint}/?access_token=${encodeURIComponent(await accessToken())}&json=true`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Moloni ${endpoint} HTTP ${res.status}`);
  return (await res.json()) as T;
}

export class MockBillingProvider implements BillingProvider {
  readonly name = "mock" as const;

  async issueReceipt(req: ReceiptRequest): Promise<IssuedReceipt> {
    return {
      documentId: `mock-${req.ourReference}`,
      documentNumber: `FR MOCK/${req.paidAt.getUTCFullYear()}/${req.ourReference}`,
      pdfUrl: null,
    };
  }
}
