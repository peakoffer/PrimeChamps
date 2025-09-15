"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { updateSubmissionStatus } from "@/lib/supabase"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"

type Status = "new" | "contacted" | "qualified" | "rejected"

export default function UpdateStatusForm({
  id,
  currentStatus,
}: {
  id: string
  currentStatus: Status
}) {
  const [status, setStatus] = useState<Status>(currentStatus)
  const [isUpdating, setIsUpdating] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  const handleUpdate = async () => {
    if (status === currentStatus) return

    try {
      setIsUpdating(true)
      await updateSubmissionStatus(id, status)

      toast({
        title: "Status updated",
        description: `Submission status updated to ${status}`,
      })

      router.refresh()
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update status",
        variant: "destructive",
      })
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={status} onValueChange={(value) => setStatus(value as Status)}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Select status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="new">New</SelectItem>
          <SelectItem value="contacted">Contacted</SelectItem>
          <SelectItem value="qualified">Qualified</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
        </SelectContent>
      </Select>

      <Button onClick={handleUpdate} disabled={isUpdating || status === currentStatus} size="sm">
        {isUpdating ? "Updating..." : "Update"}
      </Button>
    </div>
  )
}
