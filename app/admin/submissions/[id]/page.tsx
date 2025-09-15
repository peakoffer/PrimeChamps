import { getFormSubmission } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { format } from "date-fns"
import { notFound } from "next/navigation"
import UpdateStatusForm from "../update-status-form"

export const dynamic = "force-dynamic"

export default async function SubmissionDetailPage({ params }: { params: { id: string } }) {
  try {
    const submission = await getFormSubmission(params.id)

    return (
      <div className="container py-10">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Submission Details</h1>
          <div className="flex items-center gap-4">
            <span
              className={`inline-block px-3 py-1 rounded-full text-sm ${
                submission.status === "new"
                  ? "bg-blue-100 text-blue-800"
                  : submission.status === "contacted"
                    ? "bg-yellow-100 text-yellow-800"
                    : submission.status === "qualified"
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
              }`}
            >
              {submission.status || "new"}
            </span>
            <UpdateStatusForm id={submission.id} currentStatus={submission.status || "new"} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-card rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4">Contact Information</h2>
            <div className="space-y-3">
              <div>
                <span className="text-muted-foreground">Name:</span>
                <p className="font-medium">{submission.name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Email:</span>
                <p className="font-medium">{submission.email}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Phone:</span>
                <p className="font-medium">{submission.phone}</p>
              </div>
              {submission.message && (
                <div>
                  <span className="text-muted-foreground">Message:</span>
                  <p className="font-medium whitespace-pre-wrap">{submission.message}</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-card rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4">Submission Details</h2>
            <div className="space-y-3">
              <div>
                <span className="text-muted-foreground">Type:</span>
                <p className="font-medium capitalize">{submission.type}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Submitted:</span>
                <p className="font-medium">{format(new Date(submission.created_at), "PPpp")}</p>
              </div>

              {submission.type === "athlete" ? (
                <>
                  <div>
                    <span className="text-muted-foreground">Sport:</span>
                    <p className="font-medium">
                      {submission.sport === "other" ? submission.other_sport : submission.sport}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Experience:</span>
                    <p className="font-medium">{submission.experience}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Social Following:</span>
                    <p className="font-medium">{submission.social_following}</p>
                  </div>
                  {(submission.instagram || submission.tiktok || submission.youtube || submission.twitter) && (
                    <div>
                      <span className="text-muted-foreground">Social Profiles:</span>
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        {submission.instagram && (
                          <a
                            href={`https://instagram.com/${submission.instagram.replace("@", "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            Instagram: {submission.instagram}
                          </a>
                        )}
                        {submission.tiktok && (
                          <a
                            href={`https://tiktok.com/@${submission.tiktok.replace("@", "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            TikTok: {submission.tiktok}
                          </a>
                        )}
                        {submission.youtube && (
                          <a
                            href={submission.youtube}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            YouTube
                          </a>
                        )}
                        {submission.twitter && (
                          <a
                            href={`https://twitter.com/${submission.twitter.replace("@", "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            Twitter: {submission.twitter}
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {submission.type === "brand" ? (
                    <>
                      <div>
                        <span className="text-muted-foreground">Company:</span>
                        <p className="font-medium">{submission.company}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Role:</span>
                        <p className="font-medium">{submission.role}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Industry:</span>
                        <p className="font-medium">{submission.industry}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Budget:</span>
                        <p className="font-medium">{submission.budget}</p>
                      </div>
                      {submission.website && (
                        <div>
                          <span className="text-muted-foreground">Website:</span>
                          <a
                            href={submission.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block font-medium text-primary hover:underline"
                          >
                            {submission.website}
                          </a>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        <span className="text-muted-foreground">Interest:</span>
                        <p className="font-medium">{submission.goals?.replace("Interest: ", "") || "Not specified"}</p>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {submission.type === "athlete" && (
            <div className="bg-card rounded-lg p-6 shadow-sm md:col-span-2">
              <h2 className="text-xl font-semibold mb-4">Athlete Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-medium text-muted-foreground mb-2">Achievements</h3>
                  <p className="whitespace-pre-wrap">{submission.achievements}</p>
                </div>
                <div>
                  <h3 className="font-medium text-muted-foreground mb-2">Goals</h3>
                  <p className="whitespace-pre-wrap">{submission.goals}</p>
                </div>
                {submission.sponsorships && (
                  <div className="md:col-span-2">
                    <h3 className="font-medium text-muted-foreground mb-2">Current/Past Sponsorships</h3>
                    <p className="whitespace-pre-wrap">{submission.sponsorships}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {submission.type === "brand" && (
            <div className="bg-card rounded-lg p-6 shadow-sm md:col-span-2">
              <h2 className="text-xl font-semibold mb-4">Brand Campaign Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-medium text-muted-foreground mb-2">Target Sports</h3>
                  <p className="whitespace-pre-wrap">{submission.target_sports}</p>
                </div>
                <div>
                  <h3 className="font-medium text-muted-foreground mb-2">Timeline</h3>
                  <p>{submission.timeline}</p>
                </div>
                <div>
                  <h3 className="font-medium text-muted-foreground mb-2">Campaign Goals</h3>
                  <p className="whitespace-pre-wrap">{submission.campaign_goals}</p>
                </div>
                <div>
                  <h3 className="font-medium text-muted-foreground mb-2">Target Audience</h3>
                  <p className="whitespace-pre-wrap">{submission.target_audience}</p>
                </div>
              </div>
            </div>
          )}

          {submission.type === "partner" && (
            <div className="bg-card rounded-lg p-6 shadow-sm md:col-span-2">
              <h2 className="text-xl font-semibold mb-4">Partnership Inquiry Details</h2>
              <div className="space-y-3">
                <div>
                  <span className="text-muted-foreground">Interest:</span>
                  <p className="font-medium">{submission.goals?.replace("Interest: ", "") || "Not specified"}</p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-card rounded-lg p-6 shadow-sm md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Metadata</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <span className="text-muted-foreground">IP Address:</span>
                <p className="font-medium">{submission.ip_address}</p>
              </div>
              {submission.referrer && (
                <div>
                  <span className="text-muted-foreground">Referrer:</span>
                  <p className="font-medium truncate">{submission.referrer}</p>
                </div>
              )}
              <div className="md:col-span-3">
                <span className="text-muted-foreground">User Agent:</span>
                <p className="font-medium text-xs break-all">{submission.user_agent}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <Button variant="outline" asChild>
            <a href="/admin/submissions">Back to All Submissions</a>
          </Button>
        </div>
      </div>
    )
  } catch (error) {
    return notFound()
  }
}
