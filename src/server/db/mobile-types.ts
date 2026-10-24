import type { Json } from "./types";

/** Additive migration types. Regenerate the main Supabase schema after local migration. */
type Table<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] };
type Stamp = { created_at: string; updated_at: string };
export type MobileTables = {
  mobile_store_purchase_intents: Table<
    Stamp & {
      id: string;
      user_id: string;
      workspace_id: string;
      provider: string;
      offer_key: string;
      status: "pending" | "complete" | "cancelled";
      external_id: string | null;
    }
  >;
  mobile_api_operations: Table<
    Stamp & {
      id: string;
      user_id: string;
      workspace_id: string | null;
      operation: string;
      fingerprint: string;
      status: string;
      response: Json | null;
    }
  >;
  mobile_preferences: Table<
    Stamp & {
      user_id: string;
      route_sync_enabled: boolean;
      quiet_hours_start: number;
      quiet_hours_end: number;
      notification_categories: string[];
    }
  >;
  mobile_devices: Table<
    Stamp & {
      id: string;
      user_id: string;
      token: string;
      platform: string;
      timezone: string;
      enabled: boolean;
    }
  >;
  mobile_routes: Table<
    Stamp & {
      id: string;
      recorder_id: string;
      workspace_id: string;
      trip_id: string;
      started_at: string;
      ended_at: string;
      distance_meters: number;
      points: Json;
      deleted_at: string | null;
    }
  >;
  billing_contracts: Table<
    Stamp & {
      id: string;
      workspace_id: string;
      owner_user_id: string | null;
      provider: string;
      external_id: string;
      product_key: string;
      modules: string[];
      interval: string;
      status: string;
      paid_through: string | null;
      grace_until: string | null;
      renews: boolean;
      environment: string;
      verified_at: string;
      verification_revision: number;
      last_verification_attempt_at: string | null;
      pending_modules: string[] | null;
      pending_interval: string | null;
      current: boolean;
    }
  >;
  store_workspace_bindings: Table<
    Stamp & {
      id: string;
      user_id: string;
      workspace_id: string;
      provider: string;
      external_id: string;
      active: boolean;
    }
  >;
  billing_events: Table<
    Stamp & {
      id: string;
      provider: string;
      event_id: string;
      environment: string;
      external_id: string;
      status: string;
      attempts: number;
      payload: Json;
      error_code: string | null;
    }
  >;
  mobile_notification_outbox: Table<
    Stamp & {
      id: string;
      notification_id: string;
      user_id: string;
      workspace_id: string;
      category: string;
      status: string;
      attempts: number;
      next_attempt_at: string;
      error_code: string | null;
    }
  >;
  mobile_push_deliveries: Table<
    Stamp & {
      id: string;
      outbox_id: string;
      user_id: string;
      device_id: string;
      token: string;
      registration_updated_at: string;
      status:
        | "pending"
        | "deferred"
        | "sending"
        | "accepted"
        | "delivered"
        | "failed"
        | "uncertain"
        | "skipped";
      attempts: number;
      next_attempt_at: string;
      ticket_id: string | null;
      accepted_at: string | null;
      receipt_status: "pending" | "polling" | "ok" | "error" | "unknown" | null;
      receipt_attempts: number;
      receipt_poll_after: string | null;
      error_code: string | null;
    }
  >;
  account_deletion_requests: Table<{
    user_id: string;
    requested_at: string;
    purge_after: string;
    status: string;
    closed_workspace_ids: string[];
    completed_at: string | null;
  }>;
  workspace_ownership_transfers: Table<
    Stamp & {
      id: string;
      workspace_id: string;
      from_user_id: string;
      to_user_id: string;
      status: string;
      expires_at: string;
    }
  >;
};

export type MobileFunctions = {
  convert_quote_to_invoice: {
    Args: {
      p_workspace_id: string;
      p_quote_id: string;
      p_actor_id: string;
      p_invoice_id?: string | null;
      p_expected_updated_at?: string | null;
      p_number_year?: number;
    };
    Returns: Json;
  };
  mobile_start_store_purchase_intent: {
    Args: {
      p_id: string;
      p_user_id: string;
      p_workspace_id: string;
      p_provider: string;
      p_offer_key: string;
    };
    Returns: string;
  };
  mobile_cancel_store_purchase_intent: {
    Args: { p_id: string; p_user_id: string; p_workspace_id: string };
    Returns: boolean;
  };
  mobile_register_device: {
    Args: {
      p_user_id: string;
      p_device_id: string;
      p_token: string;
      p_platform: string;
      p_timezone: string;
    };
    Returns: boolean;
  };
  mobile_next_verification: { Args: Record<string, never>; Returns: number };
  mobile_change_stripe_module: {
    Args: {
      p_workspace_id: string;
      p_external_id: string;
      p_module_key: string;
      p_enabled: boolean;
      p_item_id?: string | null;
    };
    Returns: boolean;
  };
  mobile_claim_operation: {
    Args: {
      p_id: string;
      p_user_id: string;
      p_workspace_id: string | null;
      p_operation: string;
      p_fingerprint: string;
    };
    Returns: Json;
  };
  mobile_apply_receipt: {
    Args: {
      p_workspace_id: string;
      p_extraction_id: string;
      p_actor_id: string;
      p_transaction: Json;
    };
    Returns: string;
  };
  mobile_apply_store_contract: {
    Args: {
      p_user_id: string;
      p_workspace_id: string;
      p_provider: string;
      p_external_id: string;
      p_product_key: string;
      p_modules: string[];
      p_interval: string;
      p_status: string;
      p_paid_through: string | null;
      p_grace_until: string | null;
      p_renews: boolean;
      p_environment: string;
      p_previous_external_id?: string | null;
      p_verification_revision?: number;
      p_pending_modules?: string[] | null;
      p_pending_interval?: string | null;
      p_intent_id?: string | null;
      p_pending_product_key?: string | null;
    };
    Returns: Json;
  };
  mobile_apply_stripe_contract: {
    Args: {
      p_workspace_id: string;
      p_external_id: string;
      p_modules: string[];
      p_interval: string;
      p_status: string;
      p_paid_through: string | null;
      p_renews: boolean;
      p_checkout?: boolean;
      p_reservation_id?: string | null;
    };
    Returns: boolean;
  };
  mobile_reserve_stripe_checkout: {
    Args: { p_workspace_id: string; p_reservation_id: string; p_expires_at: string };
    Returns: boolean;
  };
  mobile_release_stripe_checkout: {
    Args: { p_workspace_id: string; p_reservation_id: string };
    Returns: boolean;
  };
  mobile_accept_transfer: { Args: { p_id: string; p_user_id: string }; Returns: string };
  mobile_close_account: {
    Args: { p_user_id: string; p_close_workspaces: string[] };
    Returns: Json;
  };
  mobile_purge_account: { Args: { p_user_id: string }; Returns: Json };
};
