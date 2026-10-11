import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/api";
import { LandingPage } from "@/components/landing/landing";

export default async function Home() {
  const jar = await cookies();
  if (jar.get(SESSION_COOKIE)) redirect("/my-issues");
  return <LandingPage />;
}
