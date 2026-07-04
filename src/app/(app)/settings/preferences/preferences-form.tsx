"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import {
  QUICK_ACTION_ORDER,
  QUICK_ACTION_LABELS,
  TAB_ORDER,
  TAB_LABELS,
  type QuickAction,
  type CustomerTab,
  type UserPreferences,
} from "@/lib/preferences";
import { saveUserPreferences } from "./actions";

type Item<T extends string> = { key: T; enabled: boolean };

/** Seed an ordered toggle list: enabled keys first (in the saved order), then
 *  the rest (disabled), so nothing is ever lost. */
function seed<T extends string>(all: readonly T[], enabled: T[]): Item<T>[] {
  const inEnabled = enabled.filter((k) => all.includes(k));
  const rest = all.filter((k) => !inEnabled.includes(k));
  return [
    ...inEnabled.map((key) => ({ key, enabled: true })),
    ...rest.map((key) => ({ key, enabled: false })),
  ];
}

const enabledKeys = <T extends string>(items: Item<T>[]): T[] =>
  items.filter((i) => i.enabled).map((i) => i.key);

function OrderedToggleList<T extends string>({
  title,
  hint,
  items,
  labels,
  onChange,
}: {
  title: string;
  hint: string;
  items: Item<T>[];
  labels: Record<T, string>;
  onChange: (next: Item<T>[]) => void;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const toggle = (i: number) => {
    const next = items.map((it, idx) =>
      idx === i ? { ...it, enabled: !it.enabled } : it,
    );
    onChange(next);
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1 text-sm font-medium">{title}</div>
      <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
      <ul className="divide-y">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center gap-2 py-1.5">
            <input
              type="checkbox"
              checked={it.enabled}
              onChange={() => toggle(i)}
              className="size-4 accent-primary"
              aria-label={`Show ${labels[it.key]}`}
            />
            <span
              className={cn(
                "flex-1 text-sm",
                !it.enabled && "text-muted-foreground line-through",
              )}
            >
              {labels[it.key]}
            </span>
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              aria-label="Move up"
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              aria-label="Move down"
            >
              <ChevronDown className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PreferencesForm({ prefs }: { prefs: UserPreferences }) {
  const [qa, setQa] = useState<Item<QuickAction>[]>(() =>
    seed(QUICK_ACTION_ORDER, prefs.quickActions),
  );
  const [la, setLa] = useState<Item<QuickAction>[]>(() =>
    seed(QUICK_ACTION_ORDER, prefs.listActions),
  );
  const [tabs, setTabs] = useState<Item<CustomerTab>[]>(() =>
    seed(TAB_ORDER, prefs.tabs),
  );
  const [defaultTab, setDefaultTab] = useState<CustomerTab>(prefs.defaultTab);

  const qaKeys = enabledKeys(qa);
  const laKeys = enabledKeys(la);
  const tabKeys = enabledKeys(tabs);
  // Default tab must be one that's actually visible.
  const defaultChoices = tabKeys.length ? tabKeys : (["overview"] as CustomerTab[]);
  const effectiveDefault = defaultChoices.includes(defaultTab)
    ? defaultTab
    : defaultChoices[0];

  return (
    <form action={saveUserPreferences} className="space-y-5">
      {/* Serialized state → the server action reads these hidden fields. */}
      <input type="hidden" name="quick_actions" value={qaKeys.join(",")} />
      <input type="hidden" name="list_actions" value={laKeys.join(",")} />
      <input type="hidden" name="tabs" value={tabKeys.join(",")} />
      <input type="hidden" name="default_tab" value={effectiveDefault} />

      <OrderedToggleList
        title="Quick actions — customer file"
        hint="Buttons on the Quick Actions bar at the top of a customer's page. Uncheck to hide, use the arrows to reorder."
        items={qa}
        labels={QUICK_ACTION_LABELS}
        onChange={setQa}
      />

      <OrderedToggleList
        title="Quick actions — customer list rows"
        hint="Actions shown when you expand a row on the Customers list. Can differ from the file above."
        items={la}
        labels={QUICK_ACTION_LABELS}
        onChange={setLa}
      />

      <OrderedToggleList
        title="Customer file tabs"
        hint="Which tabs appear on a customer's page, and in what order. Overview shows everything at once."
        items={tabs}
        labels={TAB_LABELS}
        onChange={setTabs}
      />

      <div className="rounded-lg border p-3">
        <label className="mb-1 block text-sm font-medium">
          Default tab
        </label>
        <p className="mb-2 text-xs text-muted-foreground">
          Which tab a customer&apos;s file opens on.
        </p>
        <select
          value={effectiveDefault}
          onChange={(e) => setDefaultTab(e.target.value as CustomerTab)}
          className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-2 text-sm"
        >
          {defaultChoices.map((k) => (
            <option key={k} value={k}>
              {TAB_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end">
        <SubmitButton pendingText="Saving…" confirm="Preferences saved">
          Save preferences
        </SubmitButton>
      </div>
    </form>
  );
}
