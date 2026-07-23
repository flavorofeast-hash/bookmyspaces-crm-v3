// lib/excel-parser.ts
// Parses Excel (.xlsx) and CSV files for lead import
// Uses xlsx library (add: npm install xlsx)

import * as XLSX from 'xlsx';
import { normalizePhone as normalizePhoneCanonical } from '@/lib/whatsapp/normalize-phone';

export interface RawLeadRow {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  source?: string;
  notes?: string;
  // Migration 018 fields — all optional, all plain strings at this layer.
  // No format validation is applied here (matches the existing, already-
  // permissive handling of date-ish/free-text fields elsewhere in this
  // parser); Postgres itself validates DATE-typed values on insert.
  city?: string;
  state?: string;
  country?: string;
  address?: string;
  date_of_visit?: string;
  birthday?: string;
  anniversary?: string;
  preferred_channel?: string;
  [key: string]: string | undefined;
}

export interface ParsedLead {
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
  source: string;
  notes: string | null;
  // Migration 018 fields — optional, additive. See RawLeadRow above.
  city: string | null;
  state: string | null;
  country: string | null;
  address: string | null;
  date_of_visit: string | null;
  birthday: string | null;
  anniversary: string | null;
  preferred_channel: string | null;
}

export interface ParseResult {
  valid: ParsedLead[];
  invalid: { row: number; data: RawLeadRow; errors: string[] }[];
  totalRows: number;
}

// Normalize phone to the same canonical, digits-only format every other
// channel converges on (e.g. "919051459463" — see
// src/lib/whatsapp/normalize-phone.ts, which is what the WhatsApp webhook
// already writes verbatim to leads.phone). This used to independently
// normalize to a "+91XXXXXXXXXX" format that never matched a lead created
// via WhatsApp (stored without a "+"), which meant a customer imported via
// Excel who later messaged on WhatsApp got a silent duplicate lead record
// instead of being recognized as the same person. Fixed in Sprint 5 — see
// audit/SPRINT5_GO_LIVE_REPORT.md, Priority 2/3, "Identity Resolution:
// inconsistent phone formats across channels".
function normalizePhone(raw: string): string {
  return normalizePhoneCanonical(raw);
}

function isValidPhone(phone: string): boolean {
  return /^\+?[1-9]\d{9,14}$/.test(phone.replace(/\s/g, ''));
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Map flexible column headers to standard fields
function mapHeaders(rawRow: Record<string, unknown>): RawLeadRow {
  const mapped: RawLeadRow = {};
  const headerMap: Record<string, keyof RawLeadRow> = {
    'name': 'name', 'full name': 'name', 'contact name': 'name', 'client name': 'name',
    'phone': 'phone', 'mobile': 'phone', 'whatsapp': 'phone', 'contact': 'phone', 'number': 'phone',
    'email': 'email', 'email address': 'email', 'mail': 'email',
    'company': 'company', 'organization': 'company', 'org': 'company', 'business': 'company',
    'source': 'source', 'lead source': 'source', 'channel': 'source',
    'notes': 'notes', 'note': 'notes', 'remarks': 'notes', 'comments': 'notes',
    // Migration 018 fields. 'channel' above stays mapped to 'source' (existing
    // behavior, unchanged) — preferred_channel uses its own, non-colliding
    // header names only.
    'city': 'city',
    'state': 'state', 'province': 'state',
    'country': 'country',
    'address': 'address', 'street address': 'address',
    'date of visit': 'date_of_visit', 'visit date': 'date_of_visit', 'date_of_visit': 'date_of_visit',
    'birthday': 'birthday', 'date of birth': 'birthday', 'dob': 'birthday',
    'anniversary': 'anniversary',
    'preferred channel': 'preferred_channel', 'preferred_channel': 'preferred_channel',
  };

  for (const [key, value] of Object.entries(rawRow)) {
    const normalKey = key.toLowerCase().trim();
    const mappedKey = headerMap[normalKey];
    if (mappedKey) {
      mapped[mappedKey] = value != null ? String(value).trim() : undefined;
    }
  }
  return mapped;
}

export function parseExcelBuffer(buffer: ArrayBuffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const valid: ParsedLead[] = [];
  const invalid: ParseResult['invalid'] = [];

  rows.forEach((rawRow, idx) => {
    const row = mapHeaders(rawRow);
    const errors: string[] = [];
    const rowNum = idx + 2; // 1-indexed + header row

    // Required: name
    if (!row.name) errors.push('Name is required');

    // Required: phone
    if (!row.phone) {
      errors.push('Phone is required');
    } else {
      const normalized = normalizePhone(row.phone);
      if (!isValidPhone(normalized)) {
        errors.push(`Invalid phone: ${row.phone}`);
      } else {
        row.phone = normalized;
      }
    }

    // Optional: email validation
    if (row.email && !isValidEmail(row.email)) {
      errors.push(`Invalid email: ${row.email}`);
    }

    if (errors.length > 0) {
      invalid.push({ row: rowNum, data: row, errors });
    } else {
      valid.push({
        name: row.name!,
        phone: row.phone!,
        email: row.email || null,
        company: row.company || null,
        source: row.source || 'excel_import',
        notes: row.notes || null,
        city: row.city || null,
        state: row.state || null,
        country: row.country || null,
        address: row.address || null,
        date_of_visit: row.date_of_visit || null,
        birthday: row.birthday || null,
        anniversary: row.anniversary || null,
        preferred_channel: row.preferred_channel || null,
      });
    }
  });

  return {
    valid,
    invalid,
    totalRows: rows.length,
  };
}
