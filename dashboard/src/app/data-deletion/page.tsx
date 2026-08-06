import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Data Deletion Instructions | Prime Champs",
  description: "How to disconnect Instagram and request deletion of Prime Champs CRM data.",
};

const listClass = "list-decimal space-y-2 pl-5";

export default function DataDeletionPage() {
  return (
    <LegalPage
      eyebrow="Prime Champs CRM"
      title="Data deletion instructions"
      summary="You can disconnect a provider immediately and request deletion of the account and connected data held by Prime Champs."
      updated="August 6, 2026"
      sections={[
        {
          title: "Disconnect Instagram from the CRM",
          content: (
            <ol className={listClass}>
              <li>Sign in to Prime Champs CRM.</li>
              <li>Open Connections and locate your Instagram account.</li>
              <li>Select Disconnect and confirm the removal.</li>
              <li>
                You may also revoke Prime Champs CRM from Instagram under Settings, Website
                permissions, Apps and websites.
              </li>
            </ol>
          ),
        },
        {
          title: "Request deletion from Prime Champs",
          content: (
            <>
              <p>
                Email{" "}
                <a className="font-semibold text-blue-700" href="mailto:zac@prime-champs.com?subject=Meta%20Data%20Deletion%20Request">
                  zac@prime-champs.com
                </a>{" "}
                with the subject <strong>Meta Data Deletion Request</strong>. Include the Instagram
                username or work email associated with the connection and enough information for
                us to verify that you control the affected account.
              </p>
              <p>
                Do not email an access token, password, app secret, or other authentication secret.
              </p>
            </>
          ),
        },
        {
          title: "What we delete",
          content: (
            <p>
              After verification, we delete or de-identify the associated provider credentials,
              synchronized conversations and messages, provider identifiers, webhook and sync
              records, and related CRM data unless retention is required for security, fraud
              prevention, dispute resolution, or another legal obligation.
            </p>
          ),
        },
        {
          title: "Timing and confirmation",
          content: (
            <p>
              We normally complete a verified request within 30 days and send confirmation when
              processing is complete. Residual encrypted backups may remain until they are
              overwritten through the ordinary backup cycle, subject to legal retention duties.
            </p>
          ),
        },
        {
          title: "Need help?",
          content: (
            <p>
              Contact{" "}
              <a className="font-semibold text-blue-700" href="mailto:zac@prime-champs.com">
                zac@prime-champs.com
              </a>{" "}
              and describe the account or connection you want removed. We will never ask for your
              Instagram password.
            </p>
          ),
        },
      ]}
    />
  );
}
