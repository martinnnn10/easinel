import type { Metadata } from "next";
import { LegalShell, H, P } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Privacy — EAS Maintenance Intelligence",
  description: "How EAS Maintenance Intelligence handles your organization's data.",
};

// Plain-language privacy summary reflecting how the platform actually behaves.
// Owner should review before relying on it as a legal document.
export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy" updated="July 2026">
      <H>What we store</H>
      <P>
        EAS stores the maintenance data your organization puts into it: assets, work
        orders, PM programs, parts, shift-handover notes, Copilot conversations, and the
        documents you upload (manuals, drawings, PLC exports). Account data is limited to
        name, email, role, and organization.
      </P>
      <H>Organization isolation</H>
      <P>
        Every record is scoped to your organization. Your data is never shown to, searched
        by, or used to answer questions for any other organization. Cross-plant OEM
        statistics are strictly opt-in, anonymized, and only published above a minimum
        pool size.
      </P>
      <H>How AI uses your data</H>
      <P>
        The Copilot reads your organization&apos;s documents and history to ground its
        answers, and cites what it used. Your data is not used to train models. If the live
        AI provider is unavailable, EAS falls back to deterministic, document-grounded
        answers and says so.
      </P>
      <H>Payments</H>
      <P>
        Card details are handled by Stripe; EAS never stores card numbers. A failed payment
        never deletes or hides your maintenance history.
      </P>
      <H>Retention &amp; export</H>
      <P>
        Your data stays in your workspace until you delete it or close your account.
        Contact us any time to export or permanently remove your organization&apos;s data.
      </P>
      <H>Contact</H>
      <P>
        Questions about privacy or data handling:{" "}
        <a className="underline underline-offset-2" href="mailto:eas@eautomatedstaffing.com">
          eas@eautomatedstaffing.com
        </a>
        .
      </P>
    </LegalShell>
  );
}
