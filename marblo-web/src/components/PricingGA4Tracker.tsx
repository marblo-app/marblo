"use client";

import { useEffect, useRef } from "react";
import { trackViewItemList } from "@/lib/gtag";
import { getPlanAmount } from "@/lib/pricing";

/**
 * Fires GA4 view_item_list once on pricing page mount.
 * Includes all subscription plans (Pro, Team, Team Plus) with both
 * monthly and annual item_variant values so the item list reflects
 * the full pricing matrix the user sees.
 */
export default function PricingGA4Tracker() {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    const items = [
      // Pro
      {
        item_id: "pro",
        item_name: "Pro",
        item_category: "subscription",
        price: getPlanAmount("pro", "monthly", "KRW") ?? 0,
        quantity: 1,
        item_variant: "monthly",
      },
      {
        item_id: "pro",
        item_name: "Pro",
        item_category: "subscription",
        price: getPlanAmount("pro", "annual", "KRW") ?? 0,
        quantity: 1,
        item_variant: "annual",
      },
      // Team (per-seat)
      {
        item_id: "team",
        item_name: "Team",
        item_category: "subscription",
        price: getPlanAmount("team", "monthly", "KRW") ?? 0,
        quantity: 1,
        item_variant: "monthly",
      },
      {
        item_id: "team",
        item_name: "Team",
        item_category: "subscription",
        price: getPlanAmount("team", "annual", "KRW") ?? 0,
        quantity: 1,
        item_variant: "annual",
      },
      // Team Plus (per-team floor)
      {
        item_id: "team_plus",
        item_name: "Team Plus",
        item_category: "subscription",
        price: getPlanAmount("team_plus", "monthly", "KRW") ?? 0,
        quantity: 1,
        item_variant: "monthly",
      },
      {
        item_id: "team_plus",
        item_name: "Team Plus",
        item_category: "subscription",
        price: getPlanAmount("team_plus", "annual", "KRW") ?? 0,
        quantity: 1,
        item_variant: "annual",
      },
    ];

    trackViewItemList({
      item_list_name: "subscription_plans",
      items,
    });
  }, []);

  return null;
}
