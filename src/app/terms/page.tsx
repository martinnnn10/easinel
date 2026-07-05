import type { Metadata } from "next";
import { LegalShell, H, P } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Terms — EAS Maintenance Intelligence",
  description: "Terms of service for EAS Maintenance Intelligence.",
};

// Plain-language terms summary. Owner should review before relying on it as a
// legal document; pilots and enterprise plans are governed by a signed order.
export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="July 2026">
      <H>The service</H>
      <P>
        EAS Maintenance Intelligence is software for industrial maintenance teams: an AI
        copilot, machine memory, work execution, and prevention tools. Pilots and paid
        plans are governed by your order form or subscription; these terms cover everyday
        use of the platform.
      </P>
      <H>Your data is yours</H>
      <P>
        Your organization owns everything it puts into EAS. We host and process it to run
        the service — nothing more. You can export it or ask us to delete it at any time.
      </P>
      <H>The AI advises — your people decide</H>
      <P>
        The Copilot grounds its answers in your documents and history and cites its
        sources, but industrial equipment is dangerous and site conditions vary. Answers
        are decision support, not instructions. Qualified personnel must apply their own
        judgment, follow site safety procedures, and comply with lock-out/tag-out at all
        times.
      </P>
      <H>Accounts &amp; acceptable use</H>
      <P>
        Keep credentials confidential and use role-based access for your team. Don&apos;t
        attempt to access other organizations&apos; data, probe the service&apos;s
        security, or resell access without an agreement.
      </P>
      <H>Billing</H>
      <P>
        Paid plans bill through Stripe. If a payment fails, live AI and new uploads may be
        limited — but your maintenance data stays readable and is never deleted for
        non-payment.
      </P>
      <H>Contact</H>
      <P>
        Questions about these terms:{" "}
        <a className="underline underline-offset-2" href="mailto:eas@eautomatedstaffing.com">
          eas@eautomatedstaffing.com
        </a>
        .
      </P>
    </LegalShell>
  );
}
