import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "CRM Privacy Policy | Prime Champs",
  description: "How Prime Champs CRM handles account, messaging, and platform data.",
};

const listClass = "list-disc space-y-2 pl-5";

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Prime Champs CRM"
      title="Privacy policy"
      summary="This policy explains how the Prime Champs customer relationship management application handles account, messaging, research, and connected-platform data."
      updated="August 6, 2026"
      sections={[
        {
          title: "Who is responsible for your information",
          content: (
            <p>
              VisionWave Agency LLC, doing business as Prime Champs, controls the information
              processed through this CRM. Questions and privacy requests can be sent to{" "}
              <a className="font-semibold text-blue-700" href="mailto:zac@prime-champs.com">
                zac@prime-champs.com
              </a>.
            </p>
          ),
        },
        {
          title: "Information we process",
          content: (
            <ul className={listClass}>
              <li>Team account details such as name, work email, role, and organization.</li>
              <li>
                Connected-account identifiers, authorization scopes, encrypted access tokens,
                and synchronization status for services such as Instagram and Microsoft.
              </li>
              <li>
                Conversations, message content, participants, timestamps, delivery status, and
                related profile information made available by a connected provider.
              </li>
              <li>
                Athlete and prospect records, research results, pipeline activity, notes,
                approvals, templates, and outreach history entered or generated in the CRM.
              </li>
              <li>Security, audit, diagnostic, and usage information needed to operate the service.</li>
            </ul>
          ),
        },
        {
          title: "How we use information",
          content: (
            <ul className={listClass}>
              <li>Authenticate team members and enforce organization and account permissions.</li>
              <li>Connect, synchronize, organize, and display authorized communication channels.</li>
              <li>
                Help an authorized user research contacts, prepare drafts, respond to inbound
                conversations, and track relationship activity.
              </li>
              <li>Secure, maintain, troubleshoot, and improve the CRM.</li>
              <li>Meet legal obligations and enforce our terms and provider policies.</li>
            </ul>
          ),
        },
        {
          title: "Instagram and Meta platform data",
          content: (
            <>
              <p>
                Prime Champs accesses Instagram data only after an authorized user connects an
                Instagram professional account and grants the requested permissions. The CRM uses
                that access to import available conversations, display messages, and let the
                connected account owner send human-reviewed replies within Meta&apos;s permitted
                messaging windows.
              </p>
              <p>
                Prime Champs does not sell Meta Platform Data or use the Instagram messaging API
                as a general cold-messaging tool. Users may disconnect Instagram at any time.
              </p>
            </>
          ),
        },
        {
          title: "AI-assisted drafts",
          content: (
            <p>
              When an authorized user requests an AI-assisted draft, a limited portion of the
              recent conversation and relevant contact context may be sent to Anthropic to produce
              that draft. Drafts are suggestions and require human review before sending.
            </p>
          ),
        },
        {
          title: "Service providers and disclosures",
          content: (
            <>
              <p>
                We use service providers to operate the CRM, including Vercel for application
                hosting and runtime services, Supabase for authentication and database services,
                and Anthropic for user-requested AI drafting. Other connected providers process
                data when a user enables their corresponding features.
              </p>
              <p>
                We may disclose information when required by law, to protect users and the service,
                or as part of a corporate transaction. We do not sell personal information.
              </p>
            </>
          ),
        },
        {
          title: "Security and retention",
          content: (
            <p>
              We use access controls, organization-level authorization, encrypted provider
              credentials, secure transport, and audit records to protect CRM data. We retain data
              while it is needed to provide the service, maintain required records, resolve
              disputes, or meet legal obligations. Connected data can be removed as described in
              our data deletion instructions.
            </p>
          ),
        },
        {
          title: "Your choices and rights",
          content: (
            <p>
              Depending on where you live, you may have rights to access, correct, delete, or
              restrict the use of your personal information. You may also revoke a connected
              provider from the provider&apos;s settings. Contact us at{" "}
              <a className="font-semibold text-blue-700" href="mailto:zac@prime-champs.com">
                zac@prime-champs.com
              </a>{" "}
              to submit a request.
            </p>
          ),
        },
        {
          title: "Policy updates",
          content: (
            <p>
              We may update this policy as the CRM, its providers, or legal requirements change.
              The date above identifies the latest version.
            </p>
          ),
        },
      ]}
    />
  );
}
