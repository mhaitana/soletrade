export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      activity_events: {
        Row: {
          actor_user_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          metadata: Json | null;
          type: string;
          workspace_id: string;
        };
        Insert: {
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json | null;
          type: string;
          workspace_id: string;
        };
        Update: {
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json | null;
          type?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_user_id_users_fk";
            columns: ["actor_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_events_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_announcements: {
        Row: {
          content: string;
          created_at: string;
          created_by_admin_id: string | null;
          id: string;
          target_workspaces: string[] | null;
          title: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          created_by_admin_id?: string | null;
          id?: string;
          target_workspaces?: string[] | null;
          title: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          created_by_admin_id?: string | null;
          id?: string;
          target_workspaces?: string[] | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_announcements_created_by_admin_id_fkey";
            columns: ["created_by_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_audit_events: {
        Row: {
          action: string;
          actor_admin_id: string;
          actor_role: Database["public"]["Enums"]["admin_role"];
          after_state: Json | null;
          before_state: Json | null;
          created_at: string;
          id: string;
          ip_address: string | null;
          metadata: Json | null;
          reason: string | null;
          target_id: string;
          target_type: string;
          ticket_id: string | null;
          user_agent: string | null;
          user_id: string | null;
          workspace_id: string | null;
        };
        Insert: {
          action: string;
          actor_admin_id: string;
          actor_role: Database["public"]["Enums"]["admin_role"];
          after_state?: Json | null;
          before_state?: Json | null;
          created_at?: string;
          id?: string;
          ip_address?: string | null;
          metadata?: Json | null;
          reason?: string | null;
          target_id: string;
          target_type: string;
          ticket_id?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          action?: string;
          actor_admin_id?: string;
          actor_role?: Database["public"]["Enums"]["admin_role"];
          after_state?: Json | null;
          before_state?: Json | null;
          created_at?: string;
          id?: string;
          ip_address?: string | null;
          metadata?: Json | null;
          reason?: string | null;
          target_id?: string;
          target_type?: string;
          ticket_id?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admin_audit_events_actor_admin_id_fkey";
            columns: ["actor_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_internal_notes: {
        Row: {
          author_admin_id: string;
          content: string;
          created_at: string;
          id: string;
          target_id: string;
          target_type: string;
          updated_at: string;
        };
        Insert: {
          author_admin_id: string;
          content: string;
          created_at?: string;
          id?: string;
          target_id: string;
          target_type: string;
          updated_at?: string;
        };
        Update: {
          author_admin_id?: string;
          content?: string;
          created_at?: string;
          id?: string;
          target_id?: string;
          target_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_internal_notes_author_admin_id_fkey";
            columns: ["author_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_role_assignments: {
        Row: {
          admin_user_id: string;
          assigned_by: string | null;
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["admin_role"];
        };
        Insert: {
          admin_user_id: string;
          assigned_by?: string | null;
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["admin_role"];
        };
        Update: {
          admin_user_id?: string;
          assigned_by?: string | null;
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["admin_role"];
        };
        Relationships: [
          {
            foreignKeyName: "admin_role_assignments_admin_user_id_fkey";
            columns: ["admin_user_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_role_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_security_events: {
        Row: {
          admin_user_id: string | null;
          created_at: string;
          event_type: string;
          id: string;
          ip_address: string | null;
          metadata: Json | null;
          user_agent: string | null;
        };
        Insert: {
          admin_user_id?: string | null;
          created_at?: string;
          event_type: string;
          id?: string;
          ip_address?: string | null;
          metadata?: Json | null;
          user_agent?: string | null;
        };
        Update: {
          admin_user_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          ip_address?: string | null;
          metadata?: Json | null;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admin_security_events_admin_user_id_fkey";
            columns: ["admin_user_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_sessions: {
        Row: {
          admin_user_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          ip_address: string | null;
          last_active_at: string;
          revoked_at: string | null;
          session_token: string;
          user_agent: string | null;
        };
        Insert: {
          admin_user_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          ip_address?: string | null;
          last_active_at?: string;
          revoked_at?: string | null;
          session_token: string;
          user_agent?: string | null;
        };
        Update: {
          admin_user_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          ip_address?: string | null;
          last_active_at?: string;
          revoked_at?: string | null;
          session_token?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admin_sessions_admin_user_id_fkey";
            columns: ["admin_user_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_users: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          is_active: boolean;
          mfa_enabled: boolean;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name: string;
          id?: string;
          is_active?: boolean;
          mfa_enabled?: boolean;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          is_active?: boolean;
          mfa_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_conversations: {
        Row: {
          created_at: string;
          id: string;
          title: string;
          updated_at: string;
          user_id: string;
          workspace_id: string;
          write_enabled: boolean;
        };
        Insert: {
          created_at?: string;
          id?: string;
          title?: string;
          updated_at?: string;
          user_id: string;
          workspace_id: string;
          write_enabled?: boolean;
        };
        Update: {
          created_at?: string;
          id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string;
          write_enabled?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "ai_conversations_user_id_users_id_fk";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_conversations_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["ai_message_role"];
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["ai_message_role"];
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["ai_message_role"];
        };
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_ai_conversations_id_fk";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "ai_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_user_id: string | null;
          created_at: string;
          id: string;
          ip: string | null;
          metadata: Json | null;
          target_id: string | null;
          target_type: string | null;
          workspace_id: string;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          ip?: string | null;
          metadata?: Json | null;
          target_id?: string | null;
          target_type?: string | null;
          workspace_id: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          ip?: string | null;
          metadata?: Json | null;
          target_id?: string | null;
          target_type?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_users_fk";
            columns: ["actor_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      background_jobs: {
        Row: {
          attempts: number;
          completed_at: string | null;
          created_at: string;
          error: string | null;
          id: string;
          name: string;
          queue: string;
          related_entity: string | null;
          run_time_ms: number | null;
          status: string;
          workspace_id: string | null;
        };
        Insert: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          name: string;
          queue?: string;
          related_entity?: string | null;
          run_time_ms?: number | null;
          status?: string;
          workspace_id?: string | null;
        };
        Update: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          name?: string;
          queue?: string;
          related_entity?: string | null;
          run_time_ms?: number | null;
          status?: string;
          workspace_id?: string | null;
        };
        Relationships: [];
      };
      billing_adjustment_approvals: {
        Row: {
          approved_by_admin_id: string | null;
          created_at: string;
          currency: string;
          id: string;
          ledger_entry_id: string | null;
          reason: string;
          requested_amount_cents: number;
          requested_by_admin_id: string;
          resolved_at: string | null;
          status: string;
          workspace_id: string;
        };
        Insert: {
          approved_by_admin_id?: string | null;
          created_at?: string;
          currency?: string;
          id?: string;
          ledger_entry_id?: string | null;
          reason: string;
          requested_amount_cents: number;
          requested_by_admin_id: string;
          resolved_at?: string | null;
          status?: string;
          workspace_id: string;
        };
        Update: {
          approved_by_admin_id?: string | null;
          created_at?: string;
          currency?: string;
          id?: string;
          ledger_entry_id?: string | null;
          reason?: string;
          requested_amount_cents?: number;
          requested_by_admin_id?: string;
          resolved_at?: string | null;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_adjustment_approvals_approved_by_admin_id_fkey";
            columns: ["approved_by_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_adjustment_approvals_ledger_entry_id_fkey";
            columns: ["ledger_entry_id"];
            isOneToOne: false;
            referencedRelation: "billing_credit_ledger";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_adjustment_approvals_requested_by_admin_id_fkey";
            columns: ["requested_by_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_adjustment_approvals_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_credit_ledger: {
        Row: {
          amount_cents: number;
          created_at: string;
          created_by_admin_id: string | null;
          currency: string;
          expires_at: string | null;
          id: string;
          internal_note: string | null;
          reason: string;
          related_invoice_id: string | null;
          related_ticket_id: string | null;
          reversed_entry_id: string | null;
          stripe_reference: string | null;
          type: Database["public"]["Enums"]["billing_credit_entry_type"];
          workspace_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          created_by_admin_id?: string | null;
          currency?: string;
          expires_at?: string | null;
          id?: string;
          internal_note?: string | null;
          reason: string;
          related_invoice_id?: string | null;
          related_ticket_id?: string | null;
          reversed_entry_id?: string | null;
          stripe_reference?: string | null;
          type: Database["public"]["Enums"]["billing_credit_entry_type"];
          workspace_id: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          created_by_admin_id?: string | null;
          currency?: string;
          expires_at?: string | null;
          id?: string;
          internal_note?: string | null;
          reason?: string;
          related_invoice_id?: string | null;
          related_ticket_id?: string | null;
          reversed_entry_id?: string | null;
          stripe_reference?: string | null;
          type?: Database["public"]["Enums"]["billing_credit_entry_type"];
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_credit_ledger_created_by_admin_id_fkey";
            columns: ["created_by_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_credit_ledger_related_ticket_id_fkey";
            columns: ["related_ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_credit_ledger_reversed_entry_id_fkey";
            columns: ["reversed_entry_id"];
            isOneToOne: false;
            referencedRelation: "billing_credit_ledger";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_credit_ledger_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      book_transactions: {
        Row: {
          amount_cents: number;
          category: string;
          created_at: string;
          currency: string;
          customer_id: string | null;
          date: string;
          description: string;
          gst_cents: number;
          id: string;
          notes: string | null;
          receipt_file_id: string | null;
          source_earning_id: string | null;
          source_expense_id: string | null;
          source_invoice_id: string | null;
          source_trip_id: string | null;
          type: Database["public"]["Enums"]["book_type"];
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          amount_cents: number;
          category: string;
          created_at?: string;
          currency?: string;
          customer_id?: string | null;
          date: string;
          description: string;
          gst_cents?: number;
          id?: string;
          notes?: string | null;
          receipt_file_id?: string | null;
          source_earning_id?: string | null;
          source_expense_id?: string | null;
          source_invoice_id?: string | null;
          source_trip_id?: string | null;
          type: Database["public"]["Enums"]["book_type"];
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          amount_cents?: number;
          category?: string;
          created_at?: string;
          currency?: string;
          customer_id?: string | null;
          date?: string;
          description?: string;
          gst_cents?: number;
          id?: string;
          notes?: string | null;
          receipt_file_id?: string | null;
          source_earning_id?: string | null;
          source_expense_id?: string | null;
          source_invoice_id?: string | null;
          source_trip_id?: string | null;
          type?: Database["public"]["Enums"]["book_type"];
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "book_transactions_customer_id_customers_id_fk";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "book_transactions_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_ledger: {
        Row: {
          actor_user_id: string | null;
          amount_cents: number;
          created_at: string;
          currency: string;
          entry_type: Database["public"]["Enums"]["credit_entry_type"];
          expires_at: string | null;
          id: string;
          metadata: Json | null;
          module_key: Database["public"]["Enums"]["module_key"] | null;
          reason: string;
          stripe_invoice_id: string | null;
          stripe_refund_id: string | null;
          workspace_id: string;
        };
        Insert: {
          actor_user_id?: string | null;
          amount_cents: number;
          created_at?: string;
          currency?: string;
          entry_type: Database["public"]["Enums"]["credit_entry_type"];
          expires_at?: string | null;
          id?: string;
          metadata?: Json | null;
          module_key?: Database["public"]["Enums"]["module_key"] | null;
          reason: string;
          stripe_invoice_id?: string | null;
          stripe_refund_id?: string | null;
          workspace_id: string;
        };
        Update: {
          actor_user_id?: string | null;
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          entry_type?: Database["public"]["Enums"]["credit_entry_type"];
          expires_at?: string | null;
          id?: string;
          metadata?: Json | null;
          module_key?: Database["public"]["Enums"]["module_key"] | null;
          reason?: string;
          stripe_invoice_id?: string | null;
          stripe_refund_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_ledger_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          company: string | null;
          created_at: string;
          deleted_at: string | null;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          phone: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          company?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          phone?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          company?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      drive_earnings: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          date: string;
          description: string;
          id: string;
          notes: string | null;
          platform: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency?: string;
          date: string;
          description: string;
          id?: string;
          notes?: string | null;
          platform: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          date?: string;
          description?: string;
          id?: string;
          notes?: string | null;
          platform?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "drive_earnings_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      drive_trips: {
        Row: {
          created_at: string;
          date: string;
          distance_meters: number;
          id: string;
          notes: string | null;
          platform: string;
          purpose: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          distance_meters: number;
          id?: string;
          notes?: string | null;
          platform: string;
          purpose?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          distance_meters?: number;
          id?: string;
          notes?: string | null;
          platform?: string;
          purpose?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "drive_trips_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_profiles: {
        Row: {
          created_at: string;
          default_vehicle_id: string | null;
          id: string;
          mileage_rate_cents_per_km: number;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          default_vehicle_id?: string | null;
          id?: string;
          mileage_rate_cents_per_km?: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          default_vehicle_id?: string | null;
          id?: string;
          mileage_rate_cents_per_km?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_profiles_default_vehicle_id_vehicles_id_fk";
            columns: ["default_vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_profiles_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_vehicle_expenses: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          date: string;
          description: string;
          id: string;
          notes: string | null;
          odometer_km: number | null;
          receipt_file_id: string | null;
          type: Database["public"]["Enums"]["vehicle_expense_type"];
          updated_at: string;
          vehicle_id: string;
          workspace_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency?: string;
          date: string;
          description: string;
          id?: string;
          notes?: string | null;
          odometer_km?: number | null;
          receipt_file_id?: string | null;
          type: Database["public"]["Enums"]["vehicle_expense_type"];
          updated_at?: string;
          vehicle_id: string;
          workspace_id: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          date?: string;
          description?: string;
          id?: string;
          notes?: string | null;
          odometer_km?: number | null;
          receipt_file_id?: string | null;
          type?: Database["public"]["Enums"]["vehicle_expense_type"];
          updated_at?: string;
          vehicle_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_vehicle_expenses_vehicle_id_vehicles_id_fk";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_vehicle_expenses_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      feature_flag_audit_events: {
        Row: {
          action: string;
          actor_admin_id: string;
          changes: Json;
          created_at: string;
          feature_flag_id: string;
          id: string;
        };
        Insert: {
          action: string;
          actor_admin_id: string;
          changes: Json;
          created_at?: string;
          feature_flag_id: string;
          id?: string;
        };
        Update: {
          action?: string;
          actor_admin_id?: string;
          changes?: Json;
          created_at?: string;
          feature_flag_id?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feature_flag_audit_events_actor_admin_id_fkey";
            columns: ["actor_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feature_flag_audit_events_feature_flag_id_fkey";
            columns: ["feature_flag_id"];
            isOneToOne: false;
            referencedRelation: "feature_flags";
            referencedColumns: ["id"];
          },
        ];
      };
      feature_flag_rules: {
        Row: {
          created_at: string;
          feature_flag_id: string;
          id: string;
          rule_type: string;
          rule_value: string;
        };
        Insert: {
          created_at?: string;
          feature_flag_id: string;
          id?: string;
          rule_type: string;
          rule_value: string;
        };
        Update: {
          created_at?: string;
          feature_flag_id?: string;
          id?: string;
          rule_type?: string;
          rule_value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feature_flag_rules_feature_flag_id_fkey";
            columns: ["feature_flag_id"];
            isOneToOne: false;
            referencedRelation: "feature_flags";
            referencedColumns: ["id"];
          },
        ];
      };
      feature_flags: {
        Row: {
          created_at: string;
          created_by_admin_id: string | null;
          description: string | null;
          enabled: boolean;
          id: string;
          key: string;
          name: string;
          rollout_percentage: number;
          updated_at: string;
          user_allowlist: string[] | null;
          workspace_allowlist: string[] | null;
          workspace_blocklist: string[] | null;
        };
        Insert: {
          created_at?: string;
          created_by_admin_id?: string | null;
          description?: string | null;
          enabled?: boolean;
          id?: string;
          key: string;
          name: string;
          rollout_percentage?: number;
          updated_at?: string;
          user_allowlist?: string[] | null;
          workspace_allowlist?: string[] | null;
          workspace_blocklist?: string[] | null;
        };
        Update: {
          created_at?: string;
          created_by_admin_id?: string | null;
          description?: string | null;
          enabled?: boolean;
          id?: string;
          key?: string;
          name?: string;
          rollout_percentage?: number;
          updated_at?: string;
          user_allowlist?: string[] | null;
          workspace_allowlist?: string[] | null;
          workspace_blocklist?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "feature_flags_created_by_admin_id_fkey";
            columns: ["created_by_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      files: {
        Row: {
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          file_name: string;
          id: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          uploaded_by_user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          file_name: string;
          id?: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          uploaded_by_user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          file_name?: string;
          id?: string;
          mime_type?: string;
          size_bytes?: number;
          storage_path?: string;
          uploaded_by_user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "files_uploaded_by_user_id_users_id_fk";
            columns: ["uploaded_by_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "files_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_line_items: {
        Row: {
          amount_cents: number;
          created_at: string;
          description: string;
          id: string;
          invoice_id: string;
          position: number;
          quantity: number;
          unit_price_cents: number;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          description: string;
          id?: string;
          invoice_id: string;
          position?: number;
          quantity?: number;
          unit_price_cents: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          description?: string;
          id?: string;
          invoice_id?: string;
          position?: number;
          quantity?: number;
          unit_price_cents?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_invoices_id_fk";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_line_items_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          created_at: string;
          currency: string;
          customer_id: string | null;
          due_date: string | null;
          id: string;
          issue_date: string;
          notes: string | null;
          number: string;
          paid_at: string | null;
          payment_methods: Json | null;
          prices_include_tax: boolean;
          public_token: string | null;
          sent_at: string | null;
          status: Database["public"]["Enums"]["invoice_status"];
          stripe_charge_id: string | null;
          stripe_payment_intent_id: string | null;
          subtotal_cents: number;
          tax_cents: number;
          tax_rate: number;
          total_cents: number;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          customer_id?: string | null;
          due_date?: string | null;
          id?: string;
          issue_date?: string;
          notes?: string | null;
          number: string;
          paid_at?: string | null;
          payment_methods?: Json | null;
          prices_include_tax?: boolean;
          public_token?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["invoice_status"];
          stripe_charge_id?: string | null;
          stripe_payment_intent_id?: string | null;
          subtotal_cents?: number;
          tax_cents?: number;
          tax_rate?: number;
          total_cents?: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          customer_id?: string | null;
          due_date?: string | null;
          id?: string;
          issue_date?: string;
          notes?: string | null;
          number?: string;
          paid_at?: string | null;
          payment_methods?: Json | null;
          prices_include_tax?: boolean;
          public_token?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["invoice_status"];
          stripe_charge_id?: string | null;
          stripe_payment_intent_id?: string | null;
          subtotal_cents?: number;
          tax_cents?: number;
          tax_rate?: number;
          total_cents?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_customers_id_fk";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      module_installations: {
        Row: {
          cancelled_at: string | null;
          created_at: string;
          id: string;
          installed_at: string;
          module_key: Database["public"]["Enums"]["module_key"];
          pending_cancellation_at: string | null;
          status: Database["public"]["Enums"]["module_installation_status"];
          stripe_subscription_item_id: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          cancelled_at?: string | null;
          created_at?: string;
          id?: string;
          installed_at?: string;
          module_key: Database["public"]["Enums"]["module_key"];
          pending_cancellation_at?: string | null;
          status?: Database["public"]["Enums"]["module_installation_status"];
          stripe_subscription_item_id?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          cancelled_at?: string | null;
          created_at?: string;
          id?: string;
          installed_at?: string;
          module_key?: Database["public"]["Enums"]["module_key"];
          pending_cancellation_at?: string | null;
          status?: Database["public"]["Enums"]["module_installation_status"];
          stripe_subscription_item_id?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "module_installations_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          read_at: string | null;
          title: string;
          type: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          read_at?: string | null;
          title: string;
          type: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          read_at?: string | null;
          title?: string;
          type?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_users_id_fk";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_incidents: {
        Row: {
          created_at: string;
          created_by_admin_id: string | null;
          description: string;
          id: string;
          resolved_at: string | null;
          status: string;
          title: string;
        };
        Insert: {
          created_at?: string;
          created_by_admin_id?: string | null;
          description: string;
          id?: string;
          resolved_at?: string | null;
          status?: string;
          title: string;
        };
        Update: {
          created_at?: string;
          created_by_admin_id?: string | null;
          description?: string;
          id?: string;
          resolved_at?: string | null;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_incidents_created_by_admin_id_fkey";
            columns: ["created_by_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      processed_webhook_events: {
        Row: {
          id: string;
          processed_at: string;
          stripe_event_id: string;
          stripe_event_type: string;
        };
        Insert: {
          id?: string;
          processed_at?: string;
          stripe_event_id: string;
          stripe_event_type: string;
        };
        Update: {
          id?: string;
          processed_at?: string;
          stripe_event_id?: string;
          stripe_event_type?: string;
        };
        Relationships: [];
      };
      promotion_assignments: {
        Row: {
          assigned_by_admin_id: string | null;
          created_at: string;
          id: string;
          promotion_id: string;
          workspace_id: string;
        };
        Insert: {
          assigned_by_admin_id?: string | null;
          created_at?: string;
          id?: string;
          promotion_id: string;
          workspace_id: string;
        };
        Update: {
          assigned_by_admin_id?: string | null;
          created_at?: string;
          id?: string;
          promotion_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promotion_assignments_assigned_by_admin_id_fkey";
            columns: ["assigned_by_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "promotion_assignments_promotion_id_fkey";
            columns: ["promotion_id"];
            isOneToOne: false;
            referencedRelation: "promotions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "promotion_assignments_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      promotion_redemptions: {
        Row: {
          id: string;
          promotion_id: string;
          redeemed_at: string;
          stripe_subscription_id: string | null;
          workspace_id: string;
        };
        Insert: {
          id?: string;
          promotion_id: string;
          redeemed_at?: string;
          stripe_subscription_id?: string | null;
          workspace_id: string;
        };
        Update: {
          id?: string;
          promotion_id?: string;
          redeemed_at?: string;
          stripe_subscription_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promotion_redemptions_promotion_id_fkey";
            columns: ["promotion_id"];
            isOneToOne: false;
            referencedRelation: "promotions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "promotion_redemptions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      promotions: {
        Row: {
          active: boolean;
          amount_off_cents: number | null;
          applies_to_intervals: string[] | null;
          applies_to_modules: string[] | null;
          created_at: string;
          created_by_admin_id: string | null;
          currency: string | null;
          discount_type: Database["public"]["Enums"]["promotion_discount_type"];
          duration: Database["public"]["Enums"]["promotion_duration"];
          duration_in_months: number | null;
          id: string;
          internal_description: string | null;
          last_synced_at: string | null;
          max_redemptions: number | null;
          name: string;
          new_customers_only: boolean;
          percent_off: number | null;
          public_code: string | null;
          redeem_by: string | null;
          stripe_coupon_active: boolean | null;
          stripe_coupon_id: string;
          stripe_promotion_code_active: boolean | null;
          stripe_promotion_code_id: string | null;
          times_redeemed: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          amount_off_cents?: number | null;
          applies_to_intervals?: string[] | null;
          applies_to_modules?: string[] | null;
          created_at?: string;
          created_by_admin_id?: string | null;
          currency?: string | null;
          discount_type: Database["public"]["Enums"]["promotion_discount_type"];
          duration: Database["public"]["Enums"]["promotion_duration"];
          duration_in_months?: number | null;
          id?: string;
          internal_description?: string | null;
          last_synced_at?: string | null;
          max_redemptions?: number | null;
          name: string;
          new_customers_only?: boolean;
          percent_off?: number | null;
          public_code?: string | null;
          redeem_by?: string | null;
          stripe_coupon_active?: boolean | null;
          stripe_coupon_id: string;
          stripe_promotion_code_active?: boolean | null;
          stripe_promotion_code_id?: string | null;
          times_redeemed?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          amount_off_cents?: number | null;
          applies_to_intervals?: string[] | null;
          applies_to_modules?: string[] | null;
          created_at?: string;
          created_by_admin_id?: string | null;
          currency?: string | null;
          discount_type?: Database["public"]["Enums"]["promotion_discount_type"];
          duration?: Database["public"]["Enums"]["promotion_duration"];
          duration_in_months?: number | null;
          id?: string;
          internal_description?: string | null;
          last_synced_at?: string | null;
          max_redemptions?: number | null;
          name?: string;
          new_customers_only?: boolean;
          percent_off?: number | null;
          public_code?: string | null;
          redeem_by?: string | null;
          stripe_coupon_active?: boolean | null;
          stripe_coupon_id?: string;
          stripe_promotion_code_active?: boolean | null;
          stripe_promotion_code_id?: string | null;
          times_redeemed?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promotions_created_by_admin_id_fkey";
            columns: ["created_by_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_acceptances: {
        Row: {
          accepted_at: string;
          accepter_email: string | null;
          accepter_name: string;
          created_at: string;
          id: string;
          ip_address: string;
          quote_id: string;
          signature: string | null;
          user_agent: string;
          workspace_id: string;
        };
        Insert: {
          accepted_at?: string;
          accepter_email?: string | null;
          accepter_name: string;
          created_at?: string;
          id?: string;
          ip_address: string;
          quote_id: string;
          signature?: string | null;
          user_agent: string;
          workspace_id: string;
        };
        Update: {
          accepted_at?: string;
          accepter_email?: string | null;
          accepter_name?: string;
          created_at?: string;
          id?: string;
          ip_address?: string;
          quote_id?: string;
          signature?: string | null;
          user_agent?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_acceptances_quote_id_quotes_id_fk";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_acceptances_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_line_items: {
        Row: {
          amount_cents: number;
          created_at: string;
          description: string;
          id: string;
          position: number;
          quantity: number;
          quote_id: string;
          unit_price_cents: number;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          description: string;
          id?: string;
          position?: number;
          quantity?: number;
          quote_id: string;
          unit_price_cents: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          description?: string;
          id?: string;
          position?: number;
          quantity?: number;
          quote_id?: string;
          unit_price_cents?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_line_items_quote_id_quotes_id_fk";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_line_items_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_sections: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          optional: boolean;
          position: number;
          quote_id: string;
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          optional?: boolean;
          position?: number;
          quote_id: string;
          title: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          optional?: boolean;
          position?: number;
          quote_id?: string;
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_sections_quote_id_quotes_id_fk";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_sections_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      quotes: {
        Row: {
          accepted_at: string | null;
          converted_at: string | null;
          converted_invoice_id: string | null;
          created_at: string;
          currency: string;
          customer_id: string | null;
          declined_at: string | null;
          id: string;
          issue_date: string;
          notes: string | null;
          number: string;
          prices_include_tax: boolean;
          public_token: string | null;
          sent_at: string | null;
          status: Database["public"]["Enums"]["quote_status"];
          subtotal_cents: number;
          tax_cents: number;
          tax_rate: number;
          terms_conditions: string | null;
          total_cents: number;
          updated_at: string;
          valid_until: string | null;
          workspace_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          converted_at?: string | null;
          converted_invoice_id?: string | null;
          created_at?: string;
          currency?: string;
          customer_id?: string | null;
          declined_at?: string | null;
          id?: string;
          issue_date?: string;
          notes?: string | null;
          number: string;
          prices_include_tax?: boolean;
          public_token?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["quote_status"];
          subtotal_cents?: number;
          tax_cents?: number;
          tax_rate?: number;
          terms_conditions?: string | null;
          total_cents?: number;
          updated_at?: string;
          valid_until?: string | null;
          workspace_id: string;
        };
        Update: {
          accepted_at?: string | null;
          converted_at?: string | null;
          converted_invoice_id?: string | null;
          created_at?: string;
          currency?: string;
          customer_id?: string | null;
          declined_at?: string | null;
          id?: string;
          issue_date?: string;
          notes?: string | null;
          number?: string;
          prices_include_tax?: boolean;
          public_token?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["quote_status"];
          subtotal_cents?: number;
          tax_cents?: number;
          tax_rate?: number;
          terms_conditions?: string | null;
          total_cents?: number;
          updated_at?: string;
          valid_until?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_customer_id_customers_id_fk";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      receipt_extractions: {
        Row: {
          actor_user_id: string | null;
          created_at: string;
          error_message: string | null;
          extracted_data: Json | null;
          file_id: string;
          id: string;
          model_used: string;
          status: Database["public"]["Enums"]["receipt_extraction_status"];
          transaction_id: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          actor_user_id?: string | null;
          created_at?: string;
          error_message?: string | null;
          extracted_data?: Json | null;
          file_id: string;
          id?: string;
          model_used: string;
          status?: Database["public"]["Enums"]["receipt_extraction_status"];
          transaction_id?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          actor_user_id?: string | null;
          created_at?: string;
          error_message?: string | null;
          extracted_data?: Json | null;
          file_id?: string;
          id?: string;
          model_used?: string;
          status?: Database["public"]["Enums"]["receipt_extraction_status"];
          transaction_id?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "receipt_extractions_actor_user_id_users_id_fk";
            columns: ["actor_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "receipt_extractions_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          addon_module_keys: string[];
          anchor_billing_date: string | null;
          anchor_module_key: string | null;
          billing_interval: Database["public"]["Enums"]["billing_interval"] | null;
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_end: string | null;
          id: string;
          status: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          addon_module_keys?: string[];
          anchor_billing_date?: string | null;
          anchor_module_key?: string | null;
          billing_interval?: Database["public"]["Enums"]["billing_interval"] | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          addon_module_keys?: string[];
          anchor_billing_date?: string | null;
          anchor_module_key?: string | null;
          billing_interval?: Database["public"]["Enums"]["billing_interval"] | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      support_access_events: {
        Row: {
          action: string;
          created_at: string;
          id: string;
          metadata: Json | null;
          session_id: string;
          target_entity: string | null;
          target_id: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          session_id: string;
          target_entity?: string | null;
          target_id?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          session_id?: string;
          target_entity?: string | null;
          target_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "support_access_events_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "support_access_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      support_access_requests: {
        Row: {
          access_level: Database["public"]["Enums"]["support_access_level"];
          created_at: string;
          customer_explanation: string | null;
          id: string;
          reason: string;
          requested_by_admin_id: string;
          requested_duration_minutes: number;
          scopes: string[];
          status: string;
          ticket_id: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          access_level?: Database["public"]["Enums"]["support_access_level"];
          created_at?: string;
          customer_explanation?: string | null;
          id?: string;
          reason: string;
          requested_by_admin_id: string;
          requested_duration_minutes?: number;
          scopes: string[];
          status?: string;
          ticket_id?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          access_level?: Database["public"]["Enums"]["support_access_level"];
          created_at?: string;
          customer_explanation?: string | null;
          id?: string;
          reason?: string;
          requested_by_admin_id?: string;
          requested_duration_minutes?: number;
          scopes?: string[];
          status?: string;
          ticket_id?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_access_requests_requested_by_admin_id_fkey";
            columns: ["requested_by_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_access_requests_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_access_requests_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      support_access_sessions: {
        Row: {
          access_level: Database["public"]["Enums"]["support_access_level"];
          admin_user_id: string;
          approved_by_user_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          reason: string;
          request_id: string;
          revoked_at: string | null;
          revoked_by_user_id: string | null;
          scopes: string[];
          starts_at: string;
          status: string;
          ticket_id: string | null;
          workspace_id: string;
        };
        Insert: {
          access_level?: Database["public"]["Enums"]["support_access_level"];
          admin_user_id: string;
          approved_by_user_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          reason: string;
          request_id: string;
          revoked_at?: string | null;
          revoked_by_user_id?: string | null;
          scopes: string[];
          starts_at?: string;
          status?: string;
          ticket_id?: string | null;
          workspace_id: string;
        };
        Update: {
          access_level?: Database["public"]["Enums"]["support_access_level"];
          admin_user_id?: string;
          approved_by_user_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          reason?: string;
          request_id?: string;
          revoked_at?: string | null;
          revoked_by_user_id?: string | null;
          scopes?: string[];
          starts_at?: string;
          status?: string;
          ticket_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_access_sessions_admin_user_id_fkey";
            columns: ["admin_user_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_access_sessions_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "support_access_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_access_sessions_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_access_sessions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      support_ticket_assignments: {
        Row: {
          assigned_admin_id: string;
          assigned_by: string | null;
          created_at: string;
          id: string;
          ticket_id: string;
        };
        Insert: {
          assigned_admin_id: string;
          assigned_by?: string | null;
          created_at?: string;
          id?: string;
          ticket_id: string;
        };
        Update: {
          assigned_admin_id?: string;
          assigned_by?: string | null;
          created_at?: string;
          id?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_ticket_assignments_assigned_admin_id_fkey";
            columns: ["assigned_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_ticket_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_ticket_assignments_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      support_ticket_messages: {
        Row: {
          author_id: string;
          author_type: string;
          content: string;
          created_at: string;
          id: string;
          is_internal: boolean;
          ticket_id: string;
        };
        Insert: {
          author_id: string;
          author_type: string;
          content: string;
          created_at?: string;
          id?: string;
          is_internal?: boolean;
          ticket_id: string;
        };
        Update: {
          author_id?: string;
          author_type?: string;
          content?: string;
          created_at?: string;
          id?: string;
          is_internal?: boolean;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          assigned_admin_id: string | null;
          category: string;
          created_at: string;
          description: string;
          id: string;
          priority: Database["public"]["Enums"]["support_ticket_priority"];
          requester_user_id: string;
          resolved_at: string | null;
          status: Database["public"]["Enums"]["support_ticket_status"];
          subject: string;
          updated_at: string;
          workspace_id: string | null;
        };
        Insert: {
          assigned_admin_id?: string | null;
          category: string;
          created_at?: string;
          description: string;
          id?: string;
          priority?: Database["public"]["Enums"]["support_ticket_priority"];
          requester_user_id: string;
          resolved_at?: string | null;
          status?: Database["public"]["Enums"]["support_ticket_status"];
          subject: string;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Update: {
          assigned_admin_id?: string | null;
          category?: string;
          created_at?: string;
          description?: string;
          id?: string;
          priority?: Database["public"]["Enums"]["support_ticket_priority"];
          requester_user_id?: string;
          resolved_at?: string | null;
          status?: Database["public"]["Enums"]["support_ticket_status"];
          subject?: string;
          updated_at?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "support_tickets_assigned_admin_id_fkey";
            columns: ["assigned_admin_id"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      tax_periods: {
        Row: {
          created_at: string;
          fiscal_year: number;
          gst_collected_cents: number;
          gst_paid_cents: number;
          id: string;
          lodged_at: string | null;
          lodged_by_user_id: string | null;
          net_gst_cents: number;
          period_label: string;
          quarter: number;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          fiscal_year: number;
          gst_collected_cents?: number;
          gst_paid_cents?: number;
          id?: string;
          lodged_at?: string | null;
          lodged_by_user_id?: string | null;
          net_gst_cents?: number;
          period_label: string;
          quarter: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          fiscal_year?: number;
          gst_collected_cents?: number;
          gst_paid_cents?: number;
          id?: string;
          lodged_at?: string | null;
          lodged_by_user_id?: string | null;
          net_gst_cents?: number;
          period_label?: string;
          quarter?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tax_periods_lodged_by_user_id_users_id_fk";
            columns: ["lodged_by_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tax_periods_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          deleted_at: string | null;
          email: string;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          email: string;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          email?: string;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      vehicles: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          make: string | null;
          model: string | null;
          name: string;
          odometer_km: number | null;
          updated_at: string;
          workspace_id: string;
          year: number | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          make?: string | null;
          model?: string | null;
          name: string;
          odometer_km?: number | null;
          updated_at?: string;
          workspace_id: string;
          year?: number | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          make?: string | null;
          model?: string | null;
          name?: string;
          odometer_km?: number | null;
          updated_at?: string;
          workspace_id?: string;
          year?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_events: {
        Row: {
          attempts: number;
          created_at: string;
          event_id: string;
          event_type: string;
          id: string;
          last_error: string | null;
          payload: Json;
          provider: string;
          status: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          event_id: string;
          event_type: string;
          id?: string;
          last_error?: string | null;
          payload: Json;
          provider?: string;
          status?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          event_id?: string;
          event_type?: string;
          id?: string;
          last_error?: string | null;
          payload?: Json;
          provider?: string;
          status?: string;
        };
        Relationships: [];
      };
      workspace_invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by_user_id: string | null;
          role: Database["public"]["Enums"]["workspace_role"];
          status: Database["public"]["Enums"]["invitation_status"];
          token: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          invited_by_user_id?: string | null;
          role?: Database["public"]["Enums"]["workspace_role"];
          status?: Database["public"]["Enums"]["invitation_status"];
          token: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by_user_id?: string | null;
          role?: Database["public"]["Enums"]["workspace_role"];
          status?: Database["public"]["Enums"]["invitation_status"];
          token?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_invited_by_user_id_users_id_fk";
            columns: ["invited_by_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_invitations_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          role: Database["public"]["Enums"]["workspace_role"];
          updated_at: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          updated_at?: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          updated_at?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_users_id_fk";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_members_workspace_id_workspaces_id_fk";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          default_currency: string;
          deleted_at: string | null;
          fy_start_month: number;
          id: string;
          invoice_prefix: string;
          name: string;
          owner_user_id: string;
          payment_methods: Json | null;
          quote_prefix: string;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          default_currency?: string;
          deleted_at?: string | null;
          fy_start_month?: number;
          id?: string;
          invoice_prefix?: string;
          name: string;
          owner_user_id: string;
          payment_methods?: Json | null;
          quote_prefix?: string;
          slug: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          default_currency?: string;
          deleted_at?: string | null;
          fy_start_month?: number;
          id?: string;
          invoice_prefix?: string;
          name?: string;
          owner_user_id?: string;
          payment_methods?: Json | null;
          quote_prefix?: string;
          slug?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_user_id_users_id_fk";
            columns: ["owner_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invitation: {
        Args: { p_token: string; p_user_email: string; p_user_id: string };
        Returns: Json;
      };
      consume_credit: {
        Args: {
          p_actor_user_id?: string;
          p_amount_cents: number;
          p_currency: string;
          p_metadata?: Json;
          p_module_key?: string;
          p_reason: string;
          p_stripe_invoice_id?: string;
          p_workspace_id: string;
        };
        Returns: {
          balance_cents: number;
          entry_id: string;
        }[];
      };
      create_invoice_with_lines: {
        Args: {
          p_currency: string;
          p_customer_id: string;
          p_due_date: string;
          p_issue_date: string;
          p_line_items: Json;
          p_notes: string;
          p_number: string;
          p_payment_methods?: Json;
          p_prices_include_tax: boolean;
          p_subtotal_cents: number;
          p_tax_cents: number;
          p_tax_rate: number;
          p_total_cents: number;
          p_workspace_id: string;
        };
        Returns: string;
      };
      create_quote_with_lines: {
        Args: {
          p_currency: string;
          p_customer_id: string;
          p_issue_date: string;
          p_line_items: Json;
          p_notes: string;
          p_number: string;
          p_prices_include_tax: boolean;
          p_sections: Json;
          p_subtotal_cents: number;
          p_tax_cents: number;
          p_tax_rate: number;
          p_terms_conditions: string;
          p_total_cents: number;
          p_valid_until: string;
          p_workspace_id: string;
        };
        Returns: string;
      };
      create_workspace_with_owner: {
        Args: { p_name: string; p_owner_user_id: string; p_slug: string };
        Returns: string;
      };
      is_conversation_owner: {
        Args: { p_conversation_id: string; p_user_id: string };
        Returns: boolean;
      };
      is_workspace_member: {
        Args: { p_user_id: string; p_workspace_id: string };
        Returns: boolean;
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
      update_invoice_with_lines: {
        Args: {
          p_invoice_id: string;
          p_line_items: Json;
          p_set: Json;
          p_workspace_id: string;
        };
        Returns: undefined;
      };
      update_quote_with_lines: {
        Args: {
          p_line_items: Json;
          p_quote_id: string;
          p_sections: Json;
          p_set: Json;
          p_workspace_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      admin_role:
        | "super_admin"
        | "operations_admin"
        | "billing_admin"
        | "support_manager"
        | "support_agent"
        | "security_auditor"
        | "read_only_admin";
      ai_message_role: "user" | "assistant";
      billing_credit_entry_type:
        | "support_adjustment"
        | "service_interruption"
        | "billing_correction"
        | "retention_credit"
        | "promotional_credit"
        | "refund_conversion"
        | "manual_adjustment"
        | "credit_applied"
        | "credit_reversed"
        | "credit_expired";
      billing_interval: "monthly" | "annual";
      book_type: "income" | "expense";
      credit_entry_type:
        "grant" | "consumption" | "refund" | "adjustment" | "promotion" | "expired";
      invitation_status: "pending" | "accepted" | "revoked";
      invoice_status: "draft" | "sent" | "viewed" | "paid" | "void" | "overdue";
      module_installation_status: "active" | "cancelled";
      module_key: "invoices" | "books" | "drive" | "quotes";
      promotion_discount_type: "percentage" | "fixed_amount";
      promotion_duration: "once" | "repeating" | "forever";
      quote_status: "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired" | "converted";
      receipt_extraction_status: "pending" | "reviewed" | "applied" | "rejected";
      subscription_status: "active" | "past_due" | "canceled" | "incomplete";
      support_access_level: "metadata_only" | "read_only" | "guided_write";
      support_access_scope:
        | "workspace_settings"
        | "customers"
        | "invoices"
        | "quotes"
        | "books"
        | "drive"
        | "files"
        | "activity"
        | "integrations"
        | "technical_logs";
      support_ticket_priority: "low" | "normal" | "high" | "urgent";
      support_ticket_status:
        "open" | "waiting_for_support" | "waiting_for_customer" | "resolved" | "closed";
      vehicle_expense_type: "fuel" | "maintenance" | "insurance" | "registration" | "other";
      workspace_role: "owner" | "admin" | "manager" | "accountant" | "employee" | "readonly";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      admin_role: [
        "super_admin",
        "operations_admin",
        "billing_admin",
        "support_manager",
        "support_agent",
        "security_auditor",
        "read_only_admin",
      ],
      ai_message_role: ["user", "assistant"],
      billing_credit_entry_type: [
        "support_adjustment",
        "service_interruption",
        "billing_correction",
        "retention_credit",
        "promotional_credit",
        "refund_conversion",
        "manual_adjustment",
        "credit_applied",
        "credit_reversed",
        "credit_expired",
      ],
      billing_interval: ["monthly", "annual"],
      book_type: ["income", "expense"],
      credit_entry_type: ["grant", "consumption", "refund", "adjustment", "promotion", "expired"],
      invitation_status: ["pending", "accepted", "revoked"],
      invoice_status: ["draft", "sent", "viewed", "paid", "void", "overdue"],
      module_installation_status: ["active", "cancelled"],
      module_key: ["invoices", "books", "drive", "quotes"],
      promotion_discount_type: ["percentage", "fixed_amount"],
      promotion_duration: ["once", "repeating", "forever"],
      quote_status: ["draft", "sent", "viewed", "accepted", "declined", "expired", "converted"],
      receipt_extraction_status: ["pending", "reviewed", "applied", "rejected"],
      subscription_status: ["active", "past_due", "canceled", "incomplete"],
      support_access_level: ["metadata_only", "read_only", "guided_write"],
      support_access_scope: [
        "workspace_settings",
        "customers",
        "invoices",
        "quotes",
        "books",
        "drive",
        "files",
        "activity",
        "integrations",
        "technical_logs",
      ],
      support_ticket_priority: ["low", "normal", "high", "urgent"],
      support_ticket_status: [
        "open",
        "waiting_for_support",
        "waiting_for_customer",
        "resolved",
        "closed",
      ],
      vehicle_expense_type: ["fuel", "maintenance", "insurance", "registration", "other"],
      workspace_role: ["owner", "admin", "manager", "accountant", "employee", "readonly"],
    },
  },
} as const;
