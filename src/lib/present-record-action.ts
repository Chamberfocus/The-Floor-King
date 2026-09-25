import type { RecordActionCenterModel } from "@/lib/record-action-center";

/**
 * Display-only condensation of an Action Center model.
 * It does not decide what to do. Buttons stay exactly as the model produced them.
 */
export interface ActionChip {
  label: string;
  tone: "done" | "open" | "warn";
}

export interface PresentedRecordAction {
  headline: string | null;
  warning: string | null;
  chips: ActionChip[];
  note: string | null;
  history: string[];
  quiet: string | null;
}

const DEPOSIT_NOTE = "Collecting the deposit does not hold the installation date.";

function factKey(line: string): string | null {
  const s = line.toLowerCase();
  if (/deposit not collected|has not been collected|no deposit is on file|^deposit due$/.test(s)) return "deposit";
  if (/not booked|can be scheduled/.test(s)) return "booked";
  if (/estimates approved|estimate approved/.test(s)) return "approved";
  if (/estimates sent|estimate sent/.test(s)) return "sent";
  if (/material|warehouse-ready/.test(s)) return "material";
  if (/service/.test(s)) return "service";
  if (/balance/.test(s)) return "balance";
  if (/approval is out of date|needs to approve/.test(s)) return "approval";
  return null;
}

function chipFor(key: string, line: string): ActionChip {
  if (key === "deposit") return { label: "Deposit due", tone: "open" };
  if (key === "booked") {
    const count = line.match(/^(\d+) installs/i);
    if (count) return { label: `${count[1]} installs not booked`, tone: "open" };
    if (/not booked/i.test(line)) return { label: "Install not booked", tone: "open" };
    return { label: "Install can be scheduled", tone: "open" };
  }
  if (key === "approved") {
    const count = line.match(/^(\d+) estimates approved/i);
    return { label: count ? `${count[1]} estimates approved` : "Estimate approved", tone: "done" };
  }
  if (key === "sent") {
    const count = line.match(/^(\d+) estimates sent/i);
    return { label: count ? `${count[1]} estimates sent` : "Estimate sent", tone: "open" };
  }
  if (key === "material") return { label: "Material not ready", tone: "warn" };
  if (key === "service") return { label: "Service open", tone: "warn" };
  if (key === "balance") return { label: "Balance due", tone: "open" };
  if (key === "approval") return { label: "Approval out of date", tone: "warn" };
  return { label: line, tone: "open" };
}

export function presentRecordAction(model: RecordActionCenterModel): PresentedRecordAction {
  const chips: ActionChip[] = [];
  const seen = new Set<string>();
  const add = (line: string) => {
    const key = factKey(line);
    if (!key || seen.has(key)) return;
    seen.add(key);
    chips.push(chipFor(key, line));
  };
  for (const line of model.situation) add(line);
  if (model.attention) add(model.attention);
  if (model.blocker) add(model.blocker);

  const warning = model.blocker;
  const visibleChips = warning
    ? chips.filter((chip) => factKey(chip.label) !== factKey(warning))
    : chips;
  if (warning && factKey(warning) === "material") {
    // "Not booked" is the same hold, already explained by the material warning.
    const booked = visibleChips.findIndex((chip) => factKey(chip.label) === "booked");
    if (booked >= 0) visibleChips.splice(booked, 1);
  }

  let note = model.also;
  if (note === DEPOSIT_NOTE) note = "Deposit does not hold the installation date.";
  const noteKey = note ? factKey(note) : null;
  if (note && noteKey && seen.has(noteKey) && !/does not|separate|after the material/i.test(note)) {
    note = null;
  }

  const headline = model.primary?.label ?? null;

  return {
    headline,
    warning,
    chips: visibleChips,
    note,
    history: model.history,
    quiet: model.primary ? null : model.quiet,
    };
}
