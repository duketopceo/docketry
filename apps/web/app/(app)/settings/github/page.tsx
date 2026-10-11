import { redirect } from "next/navigation";

// one GitHub settings surface: Settings > Integrations
export default async function GithubSettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  redirect(`/settings/integrations${q.size ? `?${q}` : ""}`);
}
