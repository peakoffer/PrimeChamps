import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "CRM Terms of Use | Prime Champs",
  description: "Terms governing authorized use of Prime Champs CRM.",
};

const listClass = "list-disc space-y-2 pl-5";

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Prime Champs CRM"
      title="Terms of use"
      summary="These terms govern access to and use of Prime Champs CRM and its connected communication, research, and workflow features."
      updated="August 6, 2026"
      sections={[
        {
          title: "Authorized business use",
          content: (
            <p>
              The CRM is provided by VisionWave Agency LLC, doing business as Prime Champs, for
              authorized business users. You must provide accurate account information, protect
              your login, and use only the organization and provider accounts you are permitted to
              access.
            </p>
          ),
        },
        {
          title: "Connected accounts",
          content: (
            <p>
              You may connect only communication accounts that you own or are authorized to
              manage. You remain responsible for activity initiated through your connected
              accounts and for complying with Instagram, Meta, Microsoft, Google, and other
              applicable provider terms and policies.
            </p>
          ),
        },
        {
          title: "Acceptable use",
          content: (
            <ul className={listClass}>
              <li>Do not send spam, deceptive messages, unlawful content, or prohibited promotions.</li>
              <li>Do not scrape, access, or disclose data without authorization.</li>
              <li>Do not bypass provider messaging windows, permissions, or technical safeguards.</li>
              <li>Do not impersonate another person or misrepresent Prime Champs relationships.</li>
              <li>Do not use the service to harm, exploit, harass, or discriminate against anyone.</li>
            </ul>
          ),
        },
        {
          title: "AI and research outputs",
          content: (
            <p>
              AI-generated drafts, scores, research, and recommendations may be incomplete or
              incorrect. They are working aids, not guarantees or professional advice. Authorized
              users must review outputs, verify important facts, and approve messages before any
              external communication is sent.
            </p>
          ),
        },
        {
          title: "Availability and changes",
          content: (
            <p>
              Connected services may limit, delay, or change the data and functionality they make
              available. We may update, suspend, or discontinue features to maintain security,
              comply with provider requirements, or improve the CRM.
            </p>
          ),
        },
        {
          title: "Intellectual property",
          content: (
            <p>
              Prime Champs owns the CRM software, branding, and original service materials.
              Customers and connected providers retain their respective rights in the content and
              data they supply. These terms do not transfer ownership of that content.
            </p>
          ),
        },
        {
          title: "Suspension and termination",
          content: (
            <p>
              We may restrict or end access for security risks, policy violations, unlawful use,
              or loss of authorization. Users may disconnect provider accounts at any time and may
              request account or connected-data deletion.
            </p>
          ),
        },
        {
          title: "Disclaimers and liability",
          content: (
            <p>
              The CRM is provided on an as-available basis. To the extent permitted by law,
              VisionWave Agency LLC disclaims implied warranties and is not responsible for
              provider outages, lost opportunities, or decisions made from unverified automated
              outputs. Nothing here limits liability that cannot legally be limited.
            </p>
          ),
        },
        {
          title: "Contact",
          content: (
            <p>
              Questions about these terms can be sent to{" "}
              <a className="font-semibold text-blue-700" href="mailto:zac@prime-champs.com">
                zac@prime-champs.com
              </a>.
            </p>
          ),
        },
      ]}
    />
  );
}
