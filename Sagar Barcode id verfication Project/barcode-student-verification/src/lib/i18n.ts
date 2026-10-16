import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import sw from "@/locales/sw.json";

const savedLang =
  typeof window !== "undefined"
    ? (localStorage.getItem("atcgate-lang") ?? "en")
    : "en";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    sw: { translation: sw },
  },
  lng: savedLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

// Persist language choice whenever it changes
i18n.on("languageChanged", (lng) => {
  try { localStorage.setItem("atcgate-lang", lng); } catch { /* ignore */ }
});

export default i18n;
