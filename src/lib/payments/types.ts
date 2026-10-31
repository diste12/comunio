export type MultibancoRequest = {
  orderId: string;
  amountCents: number;
  description: string;
  expiryDays: number;
  /** Per-condominium Ifthenpay MB key (each condominium collects into its own account). */
  mbKey: string | null;
};

export type MultibancoReference = {
  entity: string;
  reference: string;
  requestId: string;
  expiresAt: string | null;
};

export type MbWayRequest = {
  orderId: string;
  amountCents: number;
  description: string;
  /** 3519XXXXXXXX */
  phone: string;
  email?: string | null;
  mbWayKey: string | null;
};

export type MbWayResult = {
  requestId: string;
  /** Provider status code; "000" means the push notification was sent. */
  status: string;
  message: string;
};

export interface PaymentsProvider {
  readonly name: "mock" | "ifthenpay";
  createMultibancoReference(req: MultibancoRequest): Promise<MultibancoReference>;
  requestMbWay(req: MbWayRequest): Promise<MbWayResult>;
}

/** Normalised payment notification, whatever channel it came from. */
export type PaymentNotification = {
  provider: "ifthenpay" | "mock" | "bank";
  orderId: string | null;
  entity: string | null;
  reference: string | null;
  requestId: string | null;
  amountCents: number;
  method: "MULTIBANCO" | "MBWAY" | "TRANSFER";
  paidAt: Date;
  raw: Record<string, string>;
};
