export type ReceiptRequest = {
  /** Moloni company of the condominium NIF that issues the document. */
  companyId: number | null;
  documentSetId: number | null;
  productId: number | null;
  customer: {
    name: string;
    nif: string | null;
    email: string | null;
  };
  description: string;
  amountCents: number;
  paidAt: Date;
  paymentMethod: "MULTIBANCO" | "MBWAY" | "TRANSFER" | "CASH";
  /** Our reference, written on the document for reconciliation. */
  ourReference: string;
};

export type IssuedReceipt = {
  documentId: string;
  documentNumber: string | null;
  pdfUrl: string | null;
};

export interface BillingProvider {
  readonly name: "mock" | "moloni";
  issueReceipt(req: ReceiptRequest): Promise<IssuedReceipt>;
}
