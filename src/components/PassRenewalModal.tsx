import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CalendarClock, ShieldCheck, Clock, Calendar, CheckCircle2,
  HardHat, GraduationCap, ShieldAlert, Sparkles, AlertTriangle
} from "lucide-react";

export interface RenewablePerson {
  id:               string;
  full_name:        string;
  admission_number: string;
  category?:        "worker" | "intern" | "visitor" | null;
  company_name?:    string | null;
  institution?:     string | null;
  expires_at?:      string | null;
  status?:          string | null;
  notes?:           string | null;
}

interface PassRenewalModalProps {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  person:       RenewablePerson | null;
  onSuccess?:   () => void;
}

export function PassRenewalModal({
  open,
  onOpenChange,
  person,
  onSuccess,
}: PassRenewalModalProps) {
  const [newExpiryDate, setNewExpiryDate] = useState("");
  const [justification, setJustification] = useState("");
  const [isSubmitting, setIsSubmitting]   = useState(false);

  // Set default initial date when person opens
  useEffect(() => {
    if (person && open) {
      const baseDate = person.expires_at ? new Date(person.expires_at) : new Date();
      // If already expired, start count from today
      const startFrom = baseDate.getTime() < Date.now() ? new Date() : baseDate;
      const defaultPlus30 = new Date(startFrom);
      defaultPlus30.setDate(defaultPlus30.getDate() + 30);
      setNewExpiryDate(defaultPlus30.toISOString().slice(0, 10));
      setJustification("");
    }
  }, [person, open]);

  if (!person) return null;

  const currentExpiry = person.expires_at ? new Date(person.expires_at) : null;
  const isExpired = currentExpiry ? currentExpiry.getTime() < Date.now() : false;

  const applyPresetDays = (days: number) => {
    const base = isExpired || !currentExpiry ? new Date() : new Date(currentExpiry);
    base.setDate(base.getDate() + days);
    setNewExpiryDate(base.toISOString().slice(0, 10));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpiryDate) {
      toast.error("Please specify a valid expiration date.");
      return;
    }
    if (!justification.trim()) {
      toast.error("Justification / approval reason is mandatory for credential extensions.");
      return;
    }

    const newExpiryISO = new Date(`${newExpiryDate}T23:59:59`).toISOString();
    if (new Date(newExpiryISO).getTime() <= Date.now()) {
      toast.error("New expiration date must be in the future.");
      return;
    }

    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
      const auditLog = `\n[Extension ${timestamp}]: Extended to ${newExpiryDate} — Reason: ${justification.trim()}`;
      const updatedNotes = `${person.notes || ""}${auditLog}`.trim();

      const { error } = await supabase
        .from("students")
        .update({
          expires_at: newExpiryISO,
          status: "active", // Reactivates expired pass
          notes: updatedNotes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", person.id);

      if (error) throw error;

      toast.success(`Pass for ${person.full_name} successfully extended until ${newExpiryDate}.`);
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast.error(err.message || "Failed to extend pass validity.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const category = person.category || "worker";
  const org = person.company_name || person.institution || "ABB Plant 3";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-red-600/10 text-red-600">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">
                Pass Renewal & Validity Extension
              </DialogTitle>
              <DialogDescription className="text-xs">
                ABB Plant 3 Administrative Credential Extension
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Person Summary Card */}
        <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-sm text-foreground truncate">{person.full_name}</span>
              <Badge
                variant="outline"
                className={`text-[10px] uppercase font-bold px-1.5 ${
                  category === "intern"
                    ? "border-indigo-500/30 text-indigo-600 bg-indigo-500/10"
                    : category === "visitor"
                    ? "border-amber-500/30 text-amber-600 bg-amber-500/10"
                    : "border-blue-500/30 text-blue-600 bg-blue-500/10"
                }`}
              >
                {category}
              </Badge>
            </div>

            <span className="font-mono text-xs font-semibold text-foreground/80">
              {person.admission_number}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
            <span className="flex items-center gap-1 truncate max-w-[220px]">
              {category === "intern" ? (
                <GraduationCap className="h-3 w-3 text-indigo-500 shrink-0" />
              ) : (
                <HardHat className="h-3 w-3 text-blue-500 shrink-0" />
              )}
              {org}
            </span>

            <span className="flex items-center gap-1 font-medium">
              {isExpired ? (
                <span className="text-destructive font-semibold flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Expired: {currentExpiry?.toLocaleDateString()}
                </span>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> Current: {currentExpiry ? currentExpiry.toLocaleDateString() : "No Expiry"}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Extension Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Quick Preset Buttons */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">Quick Extension Presets</Label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {[
                { label: "+7 Days", days: 7 },
                { label: "+14 Days", days: 14 },
                { label: "+30 Days", days: 30 },
                { label: "+60 Days", days: 60 },
                { label: "+90 Days", days: 90 },
                { label: "+180 Days", days: 180 },
              ].map(({ label, days }) => (
                <Button
                  key={label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyPresetDays(days)}
                  className="h-8 text-[11px] font-semibold border-border hover:border-red-600/50 hover:bg-red-600/5 hover:text-red-600"
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {/* New Expiry Date Picker */}
          <div className="space-y-1.5">
            <Label htmlFor="new-expiry-date" className="text-xs font-semibold">
              New Expiration Date <span className="text-red-600">*</span>
            </Label>
            <Input
              id="new-expiry-date"
              type="date"
              value={newExpiryDate}
              onChange={(e) => setNewExpiryDate(e.target.value)}
              className="h-10 text-sm font-mono"
              required
            />
          </div>

          {/* Mandatory Justification */}
          <div className="space-y-1.5">
            <Label htmlFor="renewal-justification" className="text-xs font-semibold">
              Extension Justification & Approver Note <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="renewal-justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="e.g. Contract amendment signed through Q4; approved by Plant Security Manager."
              className="min-h-[75px] text-xs resize-none"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              This note is permanently recorded in the person's audit trail.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !newExpiryDate || !justification.trim()}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs gap-1.5"
            >
              <ShieldCheck className="h-4 w-4" />
              {isSubmitting ? "Extending Pass…" : "Authorize Extension"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
