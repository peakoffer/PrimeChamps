import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ResearchIntelligencePage from "./intelligence-client";

export default async function Page() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "owner" && user.role !== "admin") notFound();
  return <ResearchIntelligencePage />;
}
