export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_logs: {
        Row: {
          decision: Database["public"]["Enums"]["access_decision"]
          direction: Database["public"]["Enums"]["scan_direction"] | null
          gate_id: string | null
          id: string
          operator_note: string | null
          overridden: boolean | null
          reason: string | null
          scanned_at: string
          scanned_by: string | null
          scanned_code: string
          student_id: string | null
        }
        Insert: {
          decision: Database["public"]["Enums"]["access_decision"]
          direction?: Database["public"]["Enums"]["scan_direction"] | null
          gate_id?: string | null
          id?: string
          operator_note?: string | null
          overridden?: boolean | null
          reason?: string | null
          scanned_at?: string
          scanned_by?: string | null
          scanned_code: string
          student_id?: string | null
        }
        Update: {
          decision?: Database["public"]["Enums"]["access_decision"]
          direction?: Database["public"]["Enums"]["scan_direction"] | null
          gate_id?: string | null
          id?: string
          operator_note?: string | null
          overridden?: boolean | null
          reason?: string | null
          scanned_at?: string
          scanned_by?: string | null
          scanned_code?: string
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_logs_gate_id_fkey"
            columns: ["gate_id"]
            isOneToOne: false
            referencedRelation: "gates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_reads: {
        Row: {
          announcement_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          priority: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          priority?: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          priority?: string
          title?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          expected_at: string
          expires_at: string
          host_department: string | null
          host_name: string
          id: string
          notes: string | null
          purpose: string | null
          status: string
          student_id: string | null
          updated_at: string
          visitor_email: string | null
          visitor_name: string
          visitor_phone: string | null
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          expected_at: string
          expires_at: string
          host_department?: string | null
          host_name: string
          id?: string
          notes?: string | null
          purpose?: string | null
          status?: string
          student_id?: string | null
          updated_at?: string
          visitor_email?: string | null
          visitor_name: string
          visitor_phone?: string | null
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          expected_at?: string
          expires_at?: string
          host_department?: string | null
          host_name?: string
          id?: string
          notes?: string | null
          purpose?: string | null
          status?: string
          student_id?: string | null
          updated_at?: string
          visitor_email?: string | null
          visitor_name?: string
          visitor_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      gates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          location: string | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
        }
        Relationships: []
      }
      incidents: {
        Row: {
          admin_notes: string | null
          created_at: string
          description: string
          id: string
          location: string | null
          persons_involved: string | null
          reported_by: string | null
          resolved_at: string | null
          reviewed_by: string | null
          severity: string
          status: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          description: string
          id?: string
          location?: string | null
          persons_involved?: string | null
          reported_by?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          description?: string
          id?: string
          location?: string | null
          persons_involved?: string | null
          reported_by?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          error: string | null
          id: string
          kind: string
          recipient: string
          related_log_id: string | null
          related_student_id: string | null
          status: string
          subject: string | null
        }
        Insert: {
          body?: string | null
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          recipient: string
          related_log_id?: string | null
          related_student_id?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          recipient?: string
          related_log_id?: string | null
          related_student_id?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_related_log_id_fkey"
            columns: ["related_log_id"]
            isOneToOne: false
            referencedRelation: "access_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_related_student_id_fkey"
            columns: ["related_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      shifts: {
        Row: {
          created_at: string
          ended_at: string | null
          gate_id: string | null
          handover_notes: string | null
          id: string
          operator_id: string | null
          scans_allowed: number
          scans_denied: number
          scans_total: number
          started_at: string
          visitors_issued: number
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          gate_id?: string | null
          handover_notes?: string | null
          id?: string
          operator_id?: string | null
          scans_allowed?: number
          scans_denied?: number
          scans_total?: number
          started_at?: string
          visitors_issued?: number
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          gate_id?: string | null
          handover_notes?: string | null
          id?: string
          operator_id?: string | null
          scans_allowed?: number
          scans_denied?: number
          scans_total?: number
          started_at?: string
          visitors_issued?: number
        }
        Relationships: [
          {
            foreignKeyName: "shifts_gate_id_fkey"
            columns: ["gate_id"]
            isOneToOne: false
            referencedRelation: "gates"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          admission_number: string
          barcode: string
          created_at: string
          expires_at: string | null
          full_name: string
          id: string
          is_visitor: boolean
          notes: string | null
          nta_level: string
          parent_email: string | null
          parent_phone: string | null
          photo_url: string | null
          programme: string
          status: Database["public"]["Enums"]["student_status"]
          suspended_until: string | null
          suspension_reason: string | null
          updated_at: string
          year_of_study: number
        }
        Insert: {
          admission_number: string
          barcode: string
          created_at?: string
          expires_at?: string | null
          full_name: string
          id?: string
          is_visitor?: boolean
          notes?: string | null
          nta_level?: string
          parent_email?: string | null
          parent_phone?: string | null
          photo_url?: string | null
          programme?: string
          status?: Database["public"]["Enums"]["student_status"]
          suspended_until?: string | null
          suspension_reason?: string | null
          updated_at?: string
          year_of_study?: number
        }
        Update: {
          admission_number?: string
          barcode?: string
          created_at?: string
          expires_at?: string | null
          full_name?: string
          id?: string
          is_visitor?: boolean
          notes?: string | null
          nta_level?: string
          parent_email?: string | null
          parent_phone?: string | null
          photo_url?: string | null
          programme?: string
          status?: Database["public"]["Enums"]["student_status"]
          suspended_until?: string | null
          suspension_reason?: string | null
          updated_at?: string
          year_of_study?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      watchlist: {
        Row: {
          added_by: string | null
          alert_level: string
          barcode: string | null
          created_at: string
          description: string | null
          expires_at: string | null
          full_name: string
          id: string
          id_number: string | null
          is_active: boolean
          photo_url: string | null
          reason: string
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          alert_level?: string
          barcode?: string | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          full_name: string
          id?: string
          id_number?: string | null
          is_active?: boolean
          photo_url?: string | null
          reason: string
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          alert_level?: string
          barcode?: string | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          full_name?: string
          id?: string
          id_number?: string | null
          is_active?: boolean
          photo_url?: string | null
          reason?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_student_card: {
        Args: { p_code: string }
        Returns: {
          full_name:         string
          admission_number:  string
          programme:         string
          nta_level:         string
          year_of_study:     number
          status:            string
          is_visitor:        boolean
          expires_at:        string | null
          suspended_until:   string | null
          suspension_reason: string | null
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      access_decision: "allowed" | "denied" | "unknown"
      app_role: "admin" | "gate"
      scan_direction: "in" | "out"
      student_status: "active" | "suspended" | "graduated"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_decision: ["allowed", "denied", "unknown"],
      app_role: ["admin", "gate"],
      scan_direction: ["in", "out"],
      student_status: ["active", "suspended", "graduated"],
    },
  },
} as const
