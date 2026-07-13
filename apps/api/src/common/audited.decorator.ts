import { SetMetadata } from "@nestjs/common";

export const AUDITED_KEY = "boca:audited";

/**
 * Marks a handler for audit logging, e.g. @Audited("coaching_report.read").
 * Reads/exports of chef performance data MUST carry this (arhitectura.md 5.8).
 */
export const Audited = (action: string) => SetMetadata(AUDITED_KEY, action);
