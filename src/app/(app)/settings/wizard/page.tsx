import { redirect } from "next/navigation";

// The "Quote add-ons" list here duplicated the real add-on catalog. Add-ons are
// now managed in ONE place — Settings → Default pricing & add-ons (the built-in
// catalog + any custom add-ons, all pre-priced and offered in the estimate
// builder). This route redirects there so no parallel list survives.
export default function WizardSetupPage() {
  redirect("/settings/pricing");
}
