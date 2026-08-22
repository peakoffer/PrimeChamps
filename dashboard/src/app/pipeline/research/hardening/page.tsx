import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import HardeningClient from "./hardening-client";

export default async function ResearchHardeningPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "owner" && user.role !== "admin") notFound();
  return <HardeningClient />;
}
