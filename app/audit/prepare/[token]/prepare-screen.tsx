import Link from "next/link";
import { BRAND_NAME } from "@/lib/identity";
import {
  CANCEL_LABEL,
  PRE_CALL_HEADLINE,
  PRE_CALL_SUBHEADING,
  REPORT_SCHEDULE_PATH,
  scheduleHandoffPath,
  SKIP_FOR_NOW_LABEL,
} from "@/lib/copy/pre-call";
import { PrepareForm } from "./prepare-form";

function Logo({ href }: { href: string }) {
  return (
    <Link className="pre-call-logo" href={href}>
      <span className="pre-call-logo-mark">
        <img src="/audit/logo-mark.svg" alt="" width={51} height={51} />
      </span>
      <span className="pre-call-wordmark">
        <img src="/audit/wordmark.svg" alt={BRAND_NAME} width={94} height={51} />
      </span>
    </Link>
  );
}

export function PrepareScreen({
  token,
  websiteHost,
  findingOptions,
  homeHref,
  submitUrl,
  scheduleHref,
}: {
  token?: string;
  websiteHost: string;
  findingOptions: readonly string[];
  homeHref?: string;
  submitUrl?: string;
  scheduleHref?: string;
}) {
  const scheduleTo =
    scheduleHref ??
    (token ? scheduleHandoffPath(token) : REPORT_SCHEDULE_PATH);

  return (
    <main className="pre-call">
      <nav className="pre-call-nav" aria-label="Primary">
        <Logo
          href={homeHref ?? (token ? `/audit/results/${token}` : "/")}
        />
        <Link className="pre-call-nav-btn pre-call-skip" href={scheduleTo}>
          {SKIP_FOR_NOW_LABEL}
        </Link>
        <Link className="pre-call-nav-btn pre-call-cancel" href={scheduleTo}>
          {CANCEL_LABEL}
        </Link>
      </nav>

      <div className="pre-call-content">
        <header className="pre-call-hero">
          <p className="pre-call-host">{websiteHost}</p>
          <h1 className="pre-call-headline">{PRE_CALL_HEADLINE}</h1>
          <p className="pre-call-subhead">{PRE_CALL_SUBHEADING}</p>
        </header>
        <PrepareForm
          token={token}
          findingOptions={findingOptions}
          submitUrl={submitUrl}
        />
      </div>
    </main>
  );
}
