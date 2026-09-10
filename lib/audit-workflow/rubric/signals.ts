import { assessCredentials, type CredentialsMatch } from "./credentials";
import {
  assessConversionPaths,
  type ConversionPathMatch,
} from "./conversion-paths";
import { assessPhoneCta, type PhoneCtaMatch } from "./phone-cta";
import { assessSeoBasics, type SeoBasicsSignal } from "./seo-basics";
import {
  assessSecurityHealth,
  type SecurityHealthProbe,
} from "./security-health";
import { assessFaq, type FaqMatch } from "./faq";
import {
  assessOfferDifferentiation,
  type OfferMatch,
} from "./offer-differentiation";
import {
  assessProcessClarity,
  type ProcessClarityMatch,
} from "./process-clarity";
import { assessServiceArea, type ServiceAreaMatch } from "./service-area";

export interface HomeScoringSignals {
  finalUrl: string;
  protocol: "http" | "https" | "other";
  httpStatus: number;
  securityProbe?: SecurityHealthProbe | null;
  phone: PhoneCtaMatch | null;
  conversion: ConversionPathMatch | null;
  seo: SeoBasicsSignal | null;
  credentials: CredentialsMatch | null;
  serviceArea: ServiceAreaMatch | null;
  process: ProcessClarityMatch | null;
  faq: FaqMatch | null;
  offer: OfferMatch | null;
}

/**
 * Small, HTML-free snapshot taken while the home fetch is still in memory.
 */
export function extractHomeScoringSignals(input: {
  html: string;
  finalUrl: string;
  status: number;
}): HomeScoringSignals {
  const security = assessSecurityHealth({
    homeAssessed: true,
    finalUrl: input.finalUrl,
  });
  const phone = assessPhoneCta({ homeAssessed: true, html: input.html });
  const conversion = assessConversionPaths({
    homeAssessed: true,
    html: input.html,
  });
  const seo = assessSeoBasics({
    homeAssessed: true,
    html: input.html,
    finalUrl: input.finalUrl,
  });
  const credentials = assessCredentials({
    homeAssessed: true,
    html: input.html,
  });
  const serviceArea = assessServiceArea({
    homeAssessed: true,
    html: input.html,
  });
  const process = assessProcessClarity({
    homeAssessed: true,
    html: input.html,
  });
  const faq = assessFaq({
    homeAssessed: true,
    html: input.html,
  });
  const offer = assessOfferDifferentiation({
    homeAssessed: true,
    html: input.html,
  });
  return {
    finalUrl: security.signal?.finalUrl ?? input.finalUrl,
    protocol: security.signal?.protocol ?? "other",
    httpStatus: input.status,
    phone: phone.match ?? null,
    conversion: conversion.match ?? null,
    seo: seo.signal ?? null,
    credentials: credentials.match ?? null,
    serviceArea: serviceArea.match ?? null,
    process: process.match ?? null,
    faq: faq.match ?? null,
    offer: offer.match ?? null,
  };
}

/**
 * These return the outcome the signal supports on its own terms. They do NOT
 * escalate an ambiguous signal to `needs_review` — `applyHomeRubric` is the
 * single place that decides escalation, so that the suppressed outcome is
 * recorded as `pre_review_outcome` rather than lost. The ambiguity itself
 * travels on `match.ambiguity`.
 */
export function phoneOutcomeFromSignal(
  phone: PhoneCtaMatch | null | undefined,
): ReturnType<typeof assessPhoneCta>["outcome"] {
  if (!phone) return "fail";
  if (phone.kind === "tel_link" && phone.prominent) return "pass";
  return "partial";
}

export function conversionOutcomeFromSignal(
  conversion: ConversionPathMatch | null | undefined,
): ReturnType<typeof assessConversionPaths>["outcome"] {
  if (!conversion) return "fail";
  return conversion.prominent ? "pass" : "partial";
}

export function seoOutcomeFromSignal(
  seo: SeoBasicsSignal | null | undefined,
): ReturnType<typeof assessSeoBasics>["outcome"] {
  if (!seo) return "fail";
  if (seo.noindex) return "fail";
  if (seo.titleOk && seo.metaOk) return "pass";
  if (seo.titleOk || seo.metaOk) return "partial";
  return "fail";
}

export function credentialsOutcomeFromSignal(
  credentials: CredentialsMatch | null | undefined,
): ReturnType<typeof assessCredentials>["outcome"] {
  if (!credentials) return "fail";
  if (credentials.kind === "credential_word" && credentials.prominent) {
    return "pass";
  }
  return "partial";
}

export function serviceAreaOutcomeFromSignal(
  serviceArea: ServiceAreaMatch | null | undefined,
): ReturnType<typeof assessServiceArea>["outcome"] {
  if (!serviceArea) return "fail";
  return serviceArea.prominent ? "pass" : "partial";
}

export function processClarityOutcomeFromSignal(
  process: ProcessClarityMatch | null | undefined,
): ReturnType<typeof assessProcessClarity>["outcome"] {
  if (!process) return "fail";
  return process.prominent ? "pass" : "partial";
}

export function faqOutcomeFromSignal(
  faq: FaqMatch | null | undefined,
): ReturnType<typeof assessFaq>["outcome"] {
  if (!faq) return "fail";
  if (faq.kind === "faqpage_jsonld") return "pass";
  if (faq.kind === "faq_section" && faq.prominent) return "pass";
  return "partial";
}

export function offerOutcomeFromSignal(
  offer: OfferMatch | null | undefined,
): ReturnType<typeof assessOfferDifferentiation>["outcome"] {
  if (!offer) return "fail";
  return offer.prominent ? "pass" : "partial";
}
