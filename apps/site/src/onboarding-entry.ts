import { initializeOnboarding } from "./scripts/onboarding";

const root = document.querySelector<HTMLElement>("[data-onboarding]");
if (root) {
  root.dataset.appUrl = import.meta.env.PUBLIC_VERGE_APP_URL ?? "";
}

initializeOnboarding();
