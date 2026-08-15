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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      daily_assignments: {
        Row: {
          assigned_date: string
          created_at: string
          id: string
          quest_id: string
          quest_version_id: string
          status: string
          submission_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_date: string
          created_at?: string
          id?: string
          quest_id: string
          quest_version_id: string
          status?: string
          submission_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_date?: string
          created_at?: string
          id?: string
          quest_id?: string
          quest_version_id?: string
          status?: string
          submission_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_assignments_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_assignments_quest_version_id_fkey"
            columns: ["quest_version_id"]
            isOneToOne: false
            referencedRelation: "quest_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_assignments_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_initials: string
          avatar_url: string | null
          created_at: string
          current_streak: number
          display_name: string
          handle: string
          id: string
          last_completed_date: string | null
          longest_streak: number
          updated_at: string
        }
        Insert: {
          avatar_initials: string
          avatar_url?: string | null
          created_at?: string
          current_streak?: number
          display_name: string
          handle: string
          id: string
          last_completed_date?: string | null
          longest_streak?: number
          updated_at?: string
        }
        Update: {
          avatar_initials?: string
          avatar_url?: string | null
          created_at?: string
          current_streak?: number
          display_name?: string
          handle?: string
          id?: string
          last_completed_date?: string | null
          longest_streak?: number
          updated_at?: string
        }
        Relationships: []
      }
      proof_sessions: {
        Row: {
          assignment_id: string
          challenge: string
          created_at: string
          expires_at: string
          id: string
          nonce: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          assignment_id: string
          challenge: string
          created_at?: string
          expires_at: string
          id?: string
          nonce: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          assignment_id?: string
          challenge?: string
          created_at?: string
          expires_at?: string
          id?: string
          nonce?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_sessions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "daily_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quest_versions: {
        Row: {
          accent: string
          capture_tip: string
          category: string
          created_at: string
          description: string
          difficulty: string
          icon: string
          id: string
          prompt: string
          quest_id: string
          slug: string
          title: string
          verification_rules: Json
          version: number
          xp: number
        }
        Insert: {
          accent: string
          capture_tip: string
          category: string
          created_at?: string
          description: string
          difficulty: string
          icon: string
          id: string
          prompt: string
          quest_id: string
          slug: string
          title: string
          verification_rules: Json
          version: number
          xp: number
        }
        Update: {
          accent?: string
          capture_tip?: string
          category?: string
          created_at?: string
          description?: string
          difficulty?: string
          icon?: string
          id?: string
          prompt?: string
          quest_id?: string
          slug?: string
          title?: string
          verification_rules?: Json
          version?: number
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "quest_versions_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
        ]
      }
      quests: {
        Row: {
          accent: string
          active: boolean
          cadence: string
          capture_tip: string
          category: string
          created_at: string
          description: string
          difficulty: string
          icon: string
          id: string
          prompt: string
          slug: string
          state: string
          title: string
          updated_at: string
          verification_rules: Json
          xp: number
        }
        Insert: {
          accent: string
          active?: boolean
          cadence?: string
          capture_tip: string
          category: string
          created_at?: string
          description: string
          difficulty: string
          icon: string
          id: string
          prompt: string
          slug: string
          state?: string
          title: string
          updated_at?: string
          verification_rules: Json
          xp: number
        }
        Update: {
          accent?: string
          active?: boolean
          cadence?: string
          capture_tip?: string
          category?: string
          created_at?: string
          description?: string
          difficulty?: string
          icon?: string
          id?: string
          prompt?: string
          slug?: string
          state?: string
          title?: string
          updated_at?: string
          verification_rules?: Json
          xp?: number
        }
        Relationships: []
      }
      submissions: {
        Row: {
          assignment_id: string
          consensus_status: string | null
          created_at: string
          evidence_deleted_at: string | null
          evidence_hash: string
          evidence_mime: string
          evidence_path: string
          id: string
          processing_attempts: number
          processing_lease_until: string | null
          proof_session_id: string
          status: string
          transaction_hash: string | null
          user_id: string
          verification_source: string | null
          verdict: Json | null
          verified_at: string | null
        }
        Insert: {
          assignment_id: string
          consensus_status?: string | null
          created_at?: string
          evidence_deleted_at?: string | null
          evidence_hash: string
          evidence_mime: string
          evidence_path: string
          id: string
          processing_attempts?: number
          processing_lease_until?: string | null
          proof_session_id: string
          status?: string
          transaction_hash?: string | null
          user_id: string
          verification_source?: string | null
          verdict?: Json | null
          verified_at?: string | null
        }
        Update: {
          assignment_id?: string
          consensus_status?: string | null
          created_at?: string
          evidence_deleted_at?: string | null
          evidence_hash?: string
          evidence_mime?: string
          evidence_path?: string
          id?: string
          processing_attempts?: number
          processing_lease_until?: string | null
          proof_session_id?: string
          status?: string
          transaction_hash?: string | null
          user_id?: string
          verification_source?: string | null
          verdict?: Json | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "daily_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_proof_session_id_fkey"
            columns: ["proof_session_id"]
            isOneToOne: true
            referencedRelation: "proof_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_events: {
        Row: {
          amount: number
          created_at: string
          id: string
          quest_id: string | null
          reason: string
          submission_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          quest_id?: string | null
          reason: string
          submission_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          quest_id?: string | null
          reason?: string
          submission_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xp_events_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xp_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xp_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      irlquest_claim_maintenance: {
        Args: { p_min_interval_seconds: number; p_name: string }
        Returns: boolean
      }
      irlquest_complete_maintenance: {
        Args: { p_detail?: Json; p_name: string }
        Returns: undefined
      }
      irlquest_create_proof_session: {
        Args: {
          p_assignment_id: string
          p_challenge: string
          p_expires_at: string
          p_nonce: string
          p_user_id: string
        }
        Returns: {
          assignment_id: string
          challenge: string
          expires_at: string
          session_code: string
          session_id: string
        }[]
      }
      irlquest_create_submission: {
        Args: {
          p_evidence_hash: string
          p_evidence_mime: string
          p_evidence_path: string
          p_proof_session_id: string
          p_submission_id: string
          p_user_id: string
        }
        Returns: string
      }
      irlquest_claim_submission: {
        Args: {
          p_hashed_lease_seconds?: number
          p_submission_id: string
          p_unrelayed_lease_seconds?: number
          p_user_id: string
        }
        Returns: number
      }
      irlquest_ensure_assignments: {
        Args: { p_assigned_date: string; p_user_id: string }
        Returns: undefined
      }
      irlquest_finalize_submission: {
        Args: {
          p_status: string
          p_submission_id: string
          p_transaction_hash?: string
          p_verdict: Json
        }
        Returns: undefined
      }
      irlquest_finalize_submission_v2: {
        Args: {
          p_consensus_status: string | null
          p_status: string
          p_submission_id: string
          p_transaction_hash: string | null
          p_verdict: Json
          p_verification_source: string | null
        }
        Returns: undefined
      }
      irlquest_is_tester: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      irlquest_leaderboard: {
        Args: { p_limit?: number }
        Returns: {
          avatar_initials: string
          completed_quests: number
          current_streak: number
          display_name: string
          handle: string
          longest_streak: number
          rank_position: number
          total_xp: number
          user_id: string
        }[]
      }
      irlquest_scan_verification_health: {
        Args: Record<PropertyKey, never>
        Returns: {
          alert_kind: string
          open_count: number
        }[]
      }
      irlquest_take_rate_limit: {
        Args: {
          p_action: string
          p_limit: number
          p_user_id: string
          p_window_seconds: number
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
