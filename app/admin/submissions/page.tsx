import { getFormSubmissions } from "@/lib/supabase"
import { formatDistanceToNow } from "date-fns"

export const dynamic = "force-dynamic"

export default async function SubmissionsPage() {
  const submissions = await getFormSubmissions()

  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold mb-6">Form Submissions</h1>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted">
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {submissions.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-3 text-center text-muted-foreground">
                  No submissions yet
                </td>
              </tr>
            ) : (
              submissions.map((submission) => (
                <tr key={submission.id} className="border-b hover:bg-muted/50">
                  <td className="p-3">{formatDistanceToNow(new Date(submission.created_at), { addSuffix: true })}</td>
                  <td className="p-3 capitalize">{submission.type}</td>
                  <td className="p-3">{submission.name}</td>
                  <td className="p-3">{submission.email}</td>
                  <td className="p-3">
                    <span
                      className={`inline-block px-2 py-1 rounded-full text-xs ${
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
                  </td>
                  <td className="p-3">
                    <a href={`/admin/submissions/${submission.id}`} className="text-primary hover:underline">
                      View Details
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
