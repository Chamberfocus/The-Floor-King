import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  listAccessoryTypes,
  listUnprogrammed,
  programSummaries,
} from "@/lib/data/accessories";
import { unadoptedManufacturers } from "./actions";
import { AdoptPanel } from "./adopt-panel";
import { ProgramsList } from "./programs-list";
import { TypesEditor } from "./types-editor";
import { UnprogrammedList } from "./unprogrammed-list";

export const metadata: Metadata = { title: "Accessories" };
export const dynamic = "force-dynamic";

export default async function AccessoriesSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") redirect("/");

  const supabase = await createClient();
  const [types, summaries, unprogrammed, brands, { count: trimTotal }] =
    await Promise.all([
      listAccessoryTypes(),
      programSummaries(),
      listUnprogrammed(),
      unadoptedManufacturers(),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("category", "trim"),
    ]);

  const inPrograms = summaries.reduce((n, s) => n + s.itemCount, 0);
  const pendingNew = summaries.reduce((n, s) => n + s.missing, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Accessories"
        description="Transitions, moldings and trim — generated as real catalog items from a type × color cross-product, so they're searchable and orderable like any other product."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Accessory items" value={inPrograms} hint="in a program" />
        <Stat label="Programs" value={summaries.length} hint="one per flooring line" />
        <Stat label="Types" value={types.filter((t) => t.active).length} hint="priced per program" />
        <Stat
          label="New colors"
          value={pendingNew}
          hint={pendingNew ? "waiting to generate" : "all caught up"}
          highlight={pendingNew > 0}
        />
      </div>

      <AdoptPanel
        brands={brands}
        trimTotal={trimTotal ?? 0}
        alreadyAdopted={summaries.reduce((n, s) => n + s.adopted, 0)}
      />

      <TypesEditor types={types} />

      <ProgramsList summaries={summaries} types={types.filter((t) => t.active)} />

      <UnprogrammedList rows={unprogrammed} />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: number;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`text-2xl font-semibold tabular-nums ${highlight ? "text-amber-600 dark:text-amber-500" : ""}`}
        >
          {value.toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
