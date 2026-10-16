import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function LanguageSwitcher({ className }: Props) {
  const { i18n } = useTranslation();
  const isEn = i18n.language === "en";

  return (
    <div
      className={cn(
        "flex items-center rounded-full border border-border bg-muted p-0.5 text-xs font-semibold",
        className
      )}
    >
      <button
        onClick={() => i18n.changeLanguage("en")}
        className={cn(
          "rounded-full px-2.5 py-1 transition-all duration-150",
          isEn
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        EN
      </button>
      <button
        onClick={() => i18n.changeLanguage("sw")}
        className={cn(
          "rounded-full px-2.5 py-1 transition-all duration-150",
          !isEn
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        SW
      </button>
    </div>
  );
}
