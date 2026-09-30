import { redirect } from "next/navigation";

// Instagram and email now live on their own pages.
export default function InboxPage() {
  redirect("/instagram");
}
