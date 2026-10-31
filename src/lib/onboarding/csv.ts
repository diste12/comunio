import { splitLine } from "@/lib/bank/csv";
import { isValidNif, normalizePtPhone } from "@/lib/pt/nif";

/**
 * Onboarding CSV: one row per fraction (the título constitutivo), e.g.
 *
 *   fracao;permilagem;proprietario;telefone;email;nif;consentimento_email;inquilino;telefone_inquilino
 *   1A;45,25;Maria Silva;912345678;maria@x.pt;123456789;sim;;
 */
export type OnboardingResident = {
  fullName: string;
  phone: string;
  email: string | null;
  nif: string | null;
  role: "Proprietário" | "Inquilino";
  emailConsent: boolean;
};
export type OnboardingFraction = { designation: string; permilagem: number; residents: OnboardingResident[] };
export type OnboardingResult = { fractions: OnboardingFraction[]; errors: string[]; warnings: string[]; permilagemTotal: number };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z_]/g, "");
const YES = new Set(["sim", "s", "yes", "y", "1", "true", "x"]);

export function parseOnboardingCsv(text: string): OnboardingResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  const warnings: string[] = [];
  if (lines.length < 2) return { fractions: [], errors: ["O ficheiro não tem linhas de dados."], warnings, permilagemTotal: 0 };
  const sep = lines[0].includes(";") ? ";" : ",";
  const header = splitLine(lines[0], sep).map(norm);
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const idx = {
    designation: col("fracao", "fraccao", "designacao", "fraction"),
    permilagem: col("permilagem", "permil", "permillage"),
    owner: col("proprietario", "owner", "nome"),
    phone: col("telefone", "telemovel", "phone"),
    email: col("email", "mail"),
    nif: col("nif"),
    consent: col("consentimento_email", "consentimento", "consent"),
    tenant: col("inquilino", "tenant"),
    tenantPhone: col("telefone_inquilino", "tenant_phone"),
  };
  if (idx.designation < 0 || idx.permilagem < 0) {
    return { fractions: [], errors: ["Faltam as colunas obrigatórias 'fracao' e 'permilagem'."], warnings, permilagemTotal: 0 };
  }

  const fractions: OnboardingFraction[] = [];
  const seen = new Set<string>();
  for (const [i, line] of lines.slice(1).entries()) {
    const row = i + 2;
    const cells = splitLine(line, sep);
    const get = (k: keyof typeof idx) => (idx[k] >= 0 ? (cells[idx[k]] ?? "").trim() : "");
    const designation = get("designation").toUpperCase();
    const permilagem = Number(get("permilagem").replace(",", "."));
    if (!designation || designation.length > 10) { errors.push(`Linha ${row}: designação da fração inválida.`); continue; }
    if (seen.has(designation)) { errors.push(`Linha ${row}: fração ${designation} repetida.`); continue; }
    if (!(permilagem > 0 && permilagem <= 1000)) { errors.push(`Linha ${row}: permilagem inválida.`); continue; }
    seen.add(designation);

    const residents: OnboardingResident[] = [];
    const owner = get("owner");
    if (owner) {
      const phone = normalizePtPhone(get("phone"));
      const nif = get("nif") || null;
      const email = get("email") || null;
      if (!phone) errors.push(`Linha ${row}: telemóvel do proprietário em falta ou inválido (necessário para WhatsApp).`);
      if (nif && !isValidNif(nif)) errors.push(`Linha ${row}: NIF ${nif} inválido.`);
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`Linha ${row}: email inválido.`);
      const emailConsent = YES.has(get("consent").toLowerCase());
      if (emailConsent && !email) warnings.push(`Linha ${row}: consentimento de email sem email — será enviada carta registada.`);
      if (phone) residents.push({ fullName: owner, phone, email, nif, role: "Proprietário", emailConsent: emailConsent && Boolean(email) });
    } else {
      warnings.push(`Linha ${row}: fração ${designation} sem proprietário.`);
    }
    const tenant = get("tenant");
    if (tenant) {
      const phone = normalizePtPhone(get("tenantPhone"));
      if (!phone) errors.push(`Linha ${row}: telemóvel do inquilino inválido.`);
      else residents.push({ fullName: tenant, phone, email: null, nif: null, role: "Inquilino", emailConsent: false });
    }
    fractions.push({ designation, permilagem: Math.round(permilagem * 100) / 100, residents });
  }

  const permilagemTotal = Math.round(fractions.reduce((s, f) => s + f.permilagem * 100, 0)) / 100;
  if (fractions.length > 0 && Math.abs(permilagemTotal - 1000) > 0.5) {
    errors.push(`A permilagem soma ${permilagemTotal.toFixed(2)}‰; o título constitutivo tem de somar 1000‰.`);
  } else if (fractions.length > 0 && permilagemTotal !== 1000) {
    warnings.push(`A permilagem soma ${permilagemTotal.toFixed(2)}‰ (arredondamentos); as quotas serão normalizadas.`);
  }
  return { fractions, errors, warnings, permilagemTotal };
}

export const ONBOARDING_TEMPLATE = [
  "fracao;permilagem;proprietario;telefone;email;nif;consentimento_email;inquilino;telefone_inquilino",
  "R/C;250,00;Maria Silva;912345678;maria.silva@example.pt;123456789;sim;;",
  "1.º;375,00;João Santos;913456789;;;nao;Ana Costa;914567890",
  "2.º;375,00;Rui Ferreira;915678901;rui@example.pt;;sim;;",
].join("\n");
