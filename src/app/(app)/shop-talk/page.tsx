import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import {
  getShopConversation,
  listShopBoard,
  listShopThreads,
  searchShopCustomers,
  ShopTalkUnavailable,
} from "@/lib/data/shop-talk";
import { SHOP_TALK_ROLES } from "@/lib/shop-talk";
import { ShopTalkBoard } from "./shop-talk-board";

export const metadata: Metadata = { title: "Shop talk" };
export const dynamic = "force-dynamic";

const CUSTOMER_FILE = new Set(["admin", "office", "sales_manager", "salesman", "scheduler"]);

export default async function ShopTalkPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; q?: string; shop?: string }>;
}) {
  const profile = await requireRole(SHOP_TALK_ROLES);
  const params = await searchParams;
  const customerId = params.customer?.trim() || "";
  const query = params.q?.trim() || "";
  const showShop = params.shop === "1";
  let threads: Awaited<ReturnType<typeof listShopThreads>> = [];
  let shopNotes: Awaited<ReturnType<typeof listShopBoard>> = [];
  let matches: Awaited<ReturnType<typeof searchShopCustomers>> = [];
  let conversation: Awaited<ReturnType<typeof getShopConversation>> = null;
  let unavailable = false;
  try {
    [threads, shopNotes, matches, conversation] = await Promise.all([
      listShopThreads(profile.id),
      listShopBoard(),
      searchShopCustomers(query),
      customerId ? getShopConversation(customerId) : Promise.resolve(null),
    ]);
  } catch (error) {
    if (!(error instanceof ShopTalkUnavailable)) throw error;
    unavailable = true;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <RealtimeRefresh table="messages" />
      <PageHeader
        title="Shop talk"
        description="One thread per customer for the office, sales, the warehouse, and installers. It replaces the group text."
      />
      {unavailable ? (
        <p role="alert" className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Shop talk is not on the database yet. Run migration 0497_shop_talk.sql in the Supabase SQL editor, then refresh.
        </p>
      ) : (
      <ShopTalkBoard
        meId={profile.id}
        query={query}
        threads={threads}
        matches={matches}
        shopNotes={shopNotes}
        conversation={conversation}
        showShop={showShop && !conversation}
        canOpenCustomer={CUSTOMER_FILE.has(profile.role)}
      />
      )}
    </div>
  );
}
