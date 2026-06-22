/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface VerificationItem {
  name: string;
  requested: string;
  found: string;
  status: 'match' | 'quantity mismatch' | 'missing item' | 'extra item';
  action?: string;
  category?: string;
}

export interface MetaField {
  whatsappValue: string;
  fulfillmentValue: string;
  status: 'match' | 'mismatch';
}

export interface OrderCheckResult {
  confidence: number;
  verdict: string;
  allMatch: boolean;
  issueCount: number;
  items: VerificationItem[];
  meta: {
    customerName: MetaField;
    phone: MetaField;
    facility: MetaField;
    date: MetaField;
    ordererName: MetaField;
    facilityName: MetaField;
    dropArea: MetaField;
    district: MetaField;
    deliveryTime: MetaField;
  };
  insights: string[];
}

export interface AuditRecord extends OrderCheckResult {
  id: string;
  timestamp: string;
  whatsappMessage: string;
  fulfillmentConfirmation: string;
  status: 'pending' | 'resolved' | 'ignored';
  resolutionNotes?: string;
  resolvedAt?: string;
}

export interface AuditAnalytics {
  totalChecked: number;
  perfectMatches: number;
  totalWithIssues: number;
  resolvedCount: number;
  mismatchTypeCounts: {
    quantityMismatch: number;
    missingItem: number;
    extraItem: number;
    metadataMismatch: number;
  };
  commonErrorsList: { item: string; occurrences: number; type: string }[];
}

export interface VerificationRequest {
  whatsappMessage: string;
  fulfillmentConfirmation: string;
}
