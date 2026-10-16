import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, DoorOpen } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/gates")({
  component: GatesPage,
});

function GatesPage() {
  const { t } = useTranslation();
  const { isAdmin, loading } = useAuth();
  const { data: gates, refetch } = useQuery({
    queryKey: ["gates"],
    queryFn: async () => (await supabase.from("gates").select("*").order("created_at")).data ?? [],
  });
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/verify" />;

  const add = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from("gates").insert({ name: name.trim(), location: location.trim() || null });
    if (error) return toast.error(error.message);
    setName(""); setLocation(""); toast.success(t("gates.added")); refetch();
  };
  const toggle = async (id: string, is_active: boolean) => {
    await supabase.from("gates").update({ is_active }).eq("id", id);
    refetch();
  };
  const remove = async (id: string) => {
    if (!confirm(t("gates.confirm_delete"))) return;
    await supabase.from("gates").delete().eq("id", id);
    refetch();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("gates.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("gates.subtitle")}</p>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-card p-5 shadow-sm sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1.5"><Label>{t("gates.col_name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("gates.name_ph")} /></div>
        <div className="space-y-1.5"><Label>{t("gates.col_location")}</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("gates.location_ph")} /></div>
        <div className="flex items-end"><Button onClick={add}><Plus className="mr-2 h-4 w-4" /> {t("gates.add_btn")}</Button></div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {(gates ?? []).length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            <DoorOpen className="mx-auto mb-2 h-8 w-8 opacity-40" />
            {t("gates.no_gates")}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3 text-left">{t("gates.col_name")}</th><th className="px-4 py-3 text-left">{t("gates.col_location")}</th><th className="px-4 py-3 text-left">{t("gates.col_active")}</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {gates!.map((g) => (
                <tr key={g.id}>
                  <td className="px-4 py-3 font-medium">{g.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{g.location ?? "—"}</td>
                  <td className="px-4 py-3"><Switch checked={g.is_active} onCheckedChange={(v) => toggle(g.id, v)} /></td>
                  <td className="px-4 py-3 text-right"><Button variant="ghost" size="sm" onClick={() => remove(g.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
