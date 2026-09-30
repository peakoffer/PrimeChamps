import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ResearchBenchmarkPage from "./benchmark-client";

export default async function Page() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "owner" && user.role !== "admin") notFound();
  return <ResearchBenchmarkPage />;
}
