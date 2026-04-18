/**
 * Tipi schema `public` allineati alle migration in `supabase/migrations/`.
 * Quando Docker + `supabase db reset` sono disponibili, rigenerare con:
 *   npx supabase gen types typescript --local > packages/shared/src/types/database.ts
 * e ripristinare eventuali personalizzazioni documentate in guida §7.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/**
 * Sprint T-3-A (G10): schema warning emesso dall'Edge Function `slide-validator`.
 * `code` e' la chiave i18n stable (es. 'pptx_fonts_not_embedded'), `message`
 * e' la fallback in inglese, `details` payload diagnostico libero.
 */
export interface ValidationWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

export type Database = {
  public: {
    Tables: {
      activity_log: {
        Row: {
          id: string;
          tenant_id: string;
          event_id: string | null;
          actor: Database['public']['Enums']['actor_type'];
          actor_id: string | null;
          actor_name: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          event_id?: string | null;
          actor: Database['public']['Enums']['actor_type'];
          actor_id?: string | null;
          actor_name?: string | null;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          event_id?: string | null;
          actor?: Database['public']['Enums']['actor_type'];
          actor_id?: string | null;
          actor_name?: string | null;
          action?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      email_log: {
        Row: {
          id: string;
          tenant_id: string | null;
          kind: string;
          recipient: string;
          idempotency_key: string;
          status: string;
          provider_message_id: string | null;
          error_message: string | null;
          metadata: Json;
          sent_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string | null;
          kind: string;
          recipient: string;
          idempotency_key: string;
          status?: string;
          provider_message_id?: string | null;
          error_message?: string | null;
          metadata?: Json;
          sent_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          kind?: string;
          recipient?: string;
          idempotency_key?: string;
          status?: string;
          provider_message_id?: string | null;
          error_message?: string | null;
          metadata?: Json;
          sent_at?: string;
        };
        Relationships: [];
      };
      tenant_data_exports: {
        Row: {
          id: string;
          tenant_id: string;
          requested_by_user_id: string;
          requested_at: string;
          storage_path: string | null;
          byte_size: number | null;
          status: string;
          error_message: string | null;
          expires_at: string;
          ready_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          requested_by_user_id: string;
          requested_at?: string;
          storage_path?: string | null;
          byte_size?: number | null;
          status?: string;
          error_message?: string | null;
          expires_at?: string;
          ready_at?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          requested_by_user_id?: string;
          requested_at?: string;
          storage_path?: string | null;
          byte_size?: number | null;
          status?: string;
          error_message?: string | null;
          expires_at?: string;
          ready_at?: string | null;
        };
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          name_en: string | null;
          location: string | null;
          venue: string | null;
          start_date: string;
          end_date: string;
          timezone: string;
          status: Database['public']['Enums']['event_status'];
          network_mode: Database['public']['Enums']['network_mode'];
          settings: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          name_en?: string | null;
          location?: string | null;
          venue?: string | null;
          start_date: string;
          end_date: string;
          timezone?: string;
          status?: Database['public']['Enums']['event_status'];
          network_mode?: Database['public']['Enums']['network_mode'];
          settings?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          name_en?: string | null;
          location?: string | null;
          venue?: string | null;
          start_date?: string;
          end_date?: string;
          timezone?: string;
          status?: Database['public']['Enums']['event_status'];
          network_mode?: Database['public']['Enums']['network_mode'];
          settings?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      local_agents: {
        Row: {
          id: string;
          tenant_id: string;
          event_id: string;
          name: string;
          machine_id: string | null;
          lan_ip: string | null;
          lan_port: number;
          status: Database['public']['Enums']['connection_status'];
          last_heartbeat: string | null;
          cached_files_count: number;
          cached_size_bytes: number;
          agent_version: string | null;
          registered_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          event_id: string;
          name: string;
          machine_id?: string | null;
          lan_ip?: string | null;
          lan_port?: number;
          status?: Database['public']['Enums']['connection_status'];
          last_heartbeat?: string | null;
          cached_files_count?: number;
          cached_size_bytes?: number;
          agent_version?: string | null;
          registered_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          event_id?: string;
          name?: string;
          machine_id?: string | null;
          lan_ip?: string | null;
          lan_port?: number;
          status?: Database['public']['Enums']['connection_status'];
          last_heartbeat?: string | null;
          cached_files_count?: number;
          cached_size_bytes?: number;
          agent_version?: string | null;
          registered_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      paired_devices: {
        Row: {
          id: string;
          tenant_id: string;
          event_id: string;
          room_id: string | null;
          device_name: string;
          device_type: string | null;
          browser: string | null;
          user_agent: string | null;
          pair_token_hash: string;
          last_ip: string | null;
          last_seen_at: string | null;
          status: Database['public']['Enums']['connection_status'];
          paired_at: string;
          paired_by_user_id: string | null;
          notes: string | null;
          updated_at: string;
          /**
           * Sprint S-4 (G7) — ruolo del device:
           * - `'room'` (default): 1 device assegnato a 1 sala specifica.
           * - `'control_center'`: device "Centro Slide" (room_id NULL),
           *   riceve i file di TUTTE le sale dell'evento per backup/export.
           * Vedi migration 20260418090000_paired_devices_role.sql.
           */
          role: 'room' | 'control_center';
        };
        Insert: {
          id?: string;
          tenant_id: string;
          event_id: string;
          room_id?: string | null;
          device_name: string;
          device_type?: string | null;
          browser?: string | null;
          user_agent?: string | null;
          pair_token_hash: string;
          last_ip?: string | null;
          last_seen_at?: string | null;
          status?: Database['public']['Enums']['connection_status'];
          paired_at?: string;
          paired_by_user_id?: string | null;
          notes?: string | null;
          updated_at?: string;
          role?: 'room' | 'control_center';
        };
        Update: {
          id?: string;
          tenant_id?: string;
          event_id?: string;
          room_id?: string | null;
          device_name?: string;
          device_type?: string | null;
          browser?: string | null;
          user_agent?: string | null;
          pair_token_hash?: string;
          last_ip?: string | null;
          last_seen_at?: string | null;
          status?: Database['public']['Enums']['connection_status'];
          paired_at?: string;
          paired_by_user_id?: string | null;
          notes?: string | null;
          updated_at?: string;
          role?: 'room' | 'control_center';
        };
        Relationships: [];
      };
      device_metric_pings: {
        /**
         * Sprint T-2 (G9) — telemetria perf live PC sala (CPU/RAM/disco/heap)
         * NON aggregata. Append-only, retention 24h via cleanup_device_metric_pings.
         * Vedi migration 20260418100000_device_metric_pings.sql.
         */
        Row: {
          id: number;
          tenant_id: string;
          device_id: string;
          event_id: string | null;
          room_id: string | null;
          ts: string;
          source: 'browser' | 'desktop';
          js_heap_used_pct: number | null;
          js_heap_used_mb: number | null;
          storage_quota_used_pct: number | null;
          storage_quota_used_mb: number | null;
          fps: number | null;
          network_type: string | null;
          network_downlink_mbps: number | null;
          battery_pct: number | null;
          battery_charging: boolean | null;
          visibility: 'visible' | 'hidden' | null;
          cpu_pct: number | null;
          ram_used_pct: number | null;
          ram_used_mb: number | null;
          disk_free_pct: number | null;
          disk_free_gb: number | null;
          app_uptime_sec: number | null;
          playback_mode: 'auto' | 'live' | 'turbo' | null;
          device_role: 'room' | 'control_center' | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      pairing_codes: {
        Row: {
          code: string;
          tenant_id: string;
          event_id: string;
          room_id: string | null;
          generated_by_user_id: string | null;
          expires_at: string;
          consumed_at: string | null;
          consumed_by_device_id: string | null;
          created_at: string;
        };
        Insert: {
          code: string;
          tenant_id: string;
          event_id: string;
          room_id?: string | null;
          generated_by_user_id?: string | null;
          expires_at: string;
          consumed_at?: string | null;
          consumed_by_device_id?: string | null;
          created_at?: string;
        };
        Update: {
          code?: string;
          tenant_id?: string;
          event_id?: string;
          room_id?: string | null;
          generated_by_user_id?: string | null;
          expires_at?: string;
          consumed_at?: string | null;
          consumed_by_device_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      pair_claim_rate_events: {
        Row: {
          id: number;
          ip_hash: string;
          created_at: string;
        };
        Insert: {
          ip_hash: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          ip_hash?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * Sprint T-3-G (G10) — pairing token per telecomando remoto via tablet.
       * Hash SHA-256 del token UUID (token in chiaro mostrato all'admin SOLO
       * al momento della creazione). TTL 5min-7gg, revoca via revoked_at.
       */
      remote_control_pairings: {
        Row: {
          id: string;
          tenant_id: string;
          event_id: string;
          room_id: string;
          name: string;
          token_hash: string;
          created_by_user_id: string | null;
          created_at: string;
          expires_at: string;
          last_used_at: string | null;
          revoked_at: string | null;
          commands_count: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Sprint T-3-G — rate-limit eventi per pairing telecomando (60 cmd/min). */
      remote_control_rate_events: {
        Row: {
          id: number;
          pairing_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * Sprint U-4 (UX V2.0) — magic-link tokens per zero-friction
       * provisioning di PC sala. Il token plain non e' mai persistito (solo
       * lo sha256 in `token_hash`); l'admin lo riceve UNA volta sola in
       * risposta a `rpc_admin_create_room_provision_token`.
       */
      room_provision_tokens: {
        Row: {
          id: string;
          tenant_id: string;
          event_id: string;
          room_id: string;
          token_hash: string;
          label: string | null;
          max_uses: number;
          consumed_count: number;
          expires_at: string;
          revoked_at: string | null;
          created_by_user_id: string | null;
          created_at: string;
        };
        Insert: never;
        Update: {
          revoked_at?: string | null;
          consumed_count?: number;
        };
        Relationships: [];
      };
      presentation_versions: {
        Row: {
          id: string;
          presentation_id: string;
          tenant_id: string;
          version_number: number;
          storage_key: string;
          file_name: string;
          file_size_bytes: number;
          file_hash_sha256: string | null;
          mime_type: string;
          uploaded_by_speaker: boolean;
          uploaded_by_user_id: string | null;
          upload_source: Database['public']['Enums']['upload_source'];
          status: Database['public']['Enums']['version_status'];
          notes: string | null;
          created_at: string;
          validation_warnings: ValidationWarning[] | null;
          validated_at: string | null;
        };
        Insert: {
          id?: string;
          presentation_id: string;
          tenant_id: string;
          version_number?: number;
          storage_key: string;
          file_name: string;
          file_size_bytes: number;
          file_hash_sha256?: string | null;
          mime_type: string;
          uploaded_by_speaker?: boolean;
          uploaded_by_user_id?: string | null;
          upload_source?: Database['public']['Enums']['upload_source'];
          status?: Database['public']['Enums']['version_status'];
          notes?: string | null;
          created_at?: string;
          validation_warnings?: ValidationWarning[] | null;
          validated_at?: string | null;
        };
        Update: {
          id?: string;
          presentation_id?: string;
          tenant_id?: string;
          version_number?: number;
          storage_key?: string;
          file_name?: string;
          file_size_bytes?: number;
          file_hash_sha256?: string | null;
          mime_type?: string;
          uploaded_by_speaker?: boolean;
          uploaded_by_user_id?: string | null;
          upload_source?: Database['public']['Enums']['upload_source'];
          status?: Database['public']['Enums']['version_status'];
          notes?: string | null;
          created_at?: string;
          validation_warnings?: ValidationWarning[] | null;
          validated_at?: string | null;
        };
        Relationships: [];
      };
      presentations: {
        Row: {
          id: string;
          speaker_id: string | null;
          session_id: string;
          event_id: string;
          tenant_id: string;
          /** Sprint U-2: cartella opzionale per organizzazione Production. NULL = root. */
          folder_id: string | null;
          current_version_id: string | null;
          total_versions: number;
          status: Database['public']['Enums']['presentation_status'];
          reviewer_note: string | null;
          reviewed_at: string | null;
          reviewed_by_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          speaker_id?: string | null;
          session_id: string;
          event_id: string;
          tenant_id: string;
          folder_id?: string | null;
          current_version_id?: string | null;
          total_versions?: number;
          status?: Database['public']['Enums']['presentation_status'];
          reviewer_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          speaker_id?: string | null;
          session_id?: string;
          event_id?: string;
          tenant_id?: string;
          folder_id?: string | null;
          current_version_id?: string | null;
          total_versions?: number;
          status?: Database['public']['Enums']['presentation_status'];
          reviewer_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * Sprint U-2: gerarchia cartelle Production view per organizzare
       * presentations OneDrive-style. Tree ricorsivo con `parent_id`.
       */
      event_folders: {
        Row: {
          id: string;
          tenant_id: string;
          event_id: string;
          parent_id: string | null;
          name: string;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          event_id: string;
          parent_id?: string | null;
          name: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          event_id?: string;
          parent_id?: string | null;
          name?: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      room_state: {
        Row: {
          room_id: string;
          tenant_id: string;
          current_session_id: string | null;
          current_presentation_id: string | null;
          current_version_id: string | null;
          /** Sprint I (now-playing): quando il PC sala ha aperto il file in onda. */
          last_play_started_at: string | null;
          /** Sprint U-3 (On Air): indice 1-based della slide attualmente proiettata. NULL se sconosciuto. */
          current_slide_index: number | null;
          /** Sprint U-3 (On Air): numero totale di slide del file in onda. NULL se sconosciuto. */
          current_slide_total: number | null;
          sync_status: Database['public']['Enums']['sync_status'];
          agent_connection: Database['public']['Enums']['connection_status'];
          last_sync_at: string | null;
          assigned_agent_id: string | null;
          playback_mode: Database['public']['Enums']['playback_mode'];
          updated_at: string;
        };
        Insert: {
          room_id: string;
          tenant_id: string;
          current_session_id?: string | null;
          current_presentation_id?: string | null;
          current_version_id?: string | null;
          last_play_started_at?: string | null;
          current_slide_index?: number | null;
          current_slide_total?: number | null;
          sync_status?: Database['public']['Enums']['sync_status'];
          agent_connection?: Database['public']['Enums']['connection_status'];
          last_sync_at?: string | null;
          assigned_agent_id?: string | null;
          playback_mode?: Database['public']['Enums']['playback_mode'];
          updated_at?: string;
        };
        Update: {
          room_id?: string;
          tenant_id?: string;
          current_session_id?: string | null;
          current_presentation_id?: string | null;
          current_version_id?: string | null;
          last_play_started_at?: string | null;
          current_slide_index?: number | null;
          current_slide_total?: number | null;
          sync_status?: Database['public']['Enums']['sync_status'];
          agent_connection?: Database['public']['Enums']['connection_status'];
          last_sync_at?: string | null;
          assigned_agent_id?: string | null;
          playback_mode?: Database['public']['Enums']['playback_mode'];
          updated_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          event_id: string;
          tenant_id: string;
          name: string;
          name_en: string | null;
          floor: string | null;
          capacity: number | null;
          display_order: number;
          room_type: Database['public']['Enums']['room_type'];
          settings: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          tenant_id: string;
          name: string;
          name_en?: string | null;
          floor?: string | null;
          capacity?: number | null;
          display_order?: number;
          room_type?: Database['public']['Enums']['room_type'];
          settings?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          tenant_id?: string;
          name?: string;
          name_en?: string | null;
          floor?: string | null;
          capacity?: number | null;
          display_order?: number;
          room_type?: Database['public']['Enums']['room_type'];
          settings?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          room_id: string;
          event_id: string;
          tenant_id: string;
          title: string;
          title_en: string | null;
          session_type: Database['public']['Enums']['session_type'];
          scheduled_start: string;
          scheduled_end: string;
          display_order: number;
          chair_name: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          event_id: string;
          tenant_id: string;
          title: string;
          title_en?: string | null;
          session_type?: Database['public']['Enums']['session_type'];
          scheduled_start: string;
          scheduled_end: string;
          display_order?: number;
          chair_name?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          event_id?: string;
          tenant_id?: string;
          title?: string;
          title_en?: string | null;
          session_type?: Database['public']['Enums']['session_type'];
          scheduled_start?: string;
          scheduled_end?: string;
          display_order?: number;
          chair_name?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      speakers: {
        Row: {
          id: string;
          session_id: string;
          event_id: string;
          tenant_id: string;
          full_name: string;
          email: string | null;
          company: string | null;
          job_title: string | null;
          bio: string | null;
          upload_token: string | null;
          upload_token_expires_at: string | null;
          display_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          event_id: string;
          tenant_id: string;
          full_name: string;
          email?: string | null;
          company?: string | null;
          job_title?: string | null;
          bio?: string | null;
          upload_token?: string | null;
          upload_token_expires_at?: string | null;
          display_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          event_id?: string;
          tenant_id?: string;
          full_name?: string;
          email?: string | null;
          company?: string | null;
          job_title?: string | null;
          bio?: string | null;
          upload_token?: string | null;
          upload_token_expires_at?: string | null;
          display_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          plan: Database['public']['Enums']['tenant_plan'];
          ls_customer_id: string | null;
          ls_subscription_id: string | null;
          storage_used_bytes: number;
          storage_limit_bytes: number;
          max_events_per_month: number;
          max_rooms_per_event: number;
          max_devices_per_room: number;
          expires_at: string | null;
          license_key: string | null;
          license_synced_at: string | null;
          lemon_squeezy_subscription_id: string | null;
          lemon_squeezy_customer_id: string | null;
          lemon_squeezy_variant_id: string | null;
          suspended: boolean;
          onboarded_at: string | null;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          plan?: Database['public']['Enums']['tenant_plan'];
          ls_customer_id?: string | null;
          ls_subscription_id?: string | null;
          storage_used_bytes?: number;
          storage_limit_bytes?: number;
          max_events_per_month?: number;
          max_rooms_per_event?: number;
          max_devices_per_room?: number;
          expires_at?: string | null;
          license_key?: string | null;
          license_synced_at?: string | null;
          lemon_squeezy_subscription_id?: string | null;
          lemon_squeezy_customer_id?: string | null;
          lemon_squeezy_variant_id?: string | null;
          suspended?: boolean;
          onboarded_at?: string | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          plan?: Database['public']['Enums']['tenant_plan'];
          ls_customer_id?: string | null;
          ls_subscription_id?: string | null;
          storage_used_bytes?: number;
          storage_limit_bytes?: number;
          max_events_per_month?: number;
          max_rooms_per_event?: number;
          max_devices_per_room?: number;
          expires_at?: string | null;
          license_key?: string | null;
          license_synced_at?: string | null;
          lemon_squeezy_subscription_id?: string | null;
          lemon_squeezy_customer_id?: string | null;
          lemon_squeezy_variant_id?: string | null;
          suspended?: boolean;
          onboarded_at?: string | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      lemon_squeezy_plan_mapping: {
        Row: {
          variant_id: string;
          plan: Database['public']['Enums']['tenant_plan'];
          storage_limit_bytes: number;
          max_events_per_month: number;
          max_rooms_per_event: number;
          max_devices_per_room: number;
          display_name: string;
          active: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          variant_id: string;
          plan: Database['public']['Enums']['tenant_plan'];
          storage_limit_bytes: number;
          max_events_per_month: number;
          max_rooms_per_event: number;
          max_devices_per_room: number;
          display_name: string;
          active?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          variant_id?: string;
          plan?: Database['public']['Enums']['tenant_plan'];
          storage_limit_bytes?: number;
          max_events_per_month?: number;
          max_rooms_per_event?: number;
          max_devices_per_room?: number;
          display_name?: string;
          active?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      lemon_squeezy_event_log: {
        Row: {
          id: string;
          event_id: string;
          event_name: string;
          subscription_id: string | null;
          customer_id: string | null;
          tenant_id: string | null;
          received_at: string;
          processed_at: string | null;
          processing_status: 'received' | 'processed' | 'skipped' | 'failed';
          payload: Json;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          event_id: string;
          event_name: string;
          subscription_id?: string | null;
          customer_id?: string | null;
          tenant_id?: string | null;
          received_at?: string;
          processed_at?: string | null;
          processing_status?: 'received' | 'processed' | 'skipped' | 'failed';
          payload: Json;
          error_message?: string | null;
        };
        Update: {
          id?: string;
          event_id?: string;
          event_name?: string;
          subscription_id?: string | null;
          customer_id?: string | null;
          tenant_id?: string | null;
          received_at?: string;
          processed_at?: string | null;
          processing_status?: 'received' | 'processed' | 'skipped' | 'failed';
          payload?: Json;
          error_message?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'lemon_squeezy_event_log_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      team_invitations: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          role: Database['public']['Enums']['user_role'];
          invited_by_user_id: string | null;
          invited_by_role: string;
          invite_token: string;
          invite_token_expires_at: string;
          accepted_at: string | null;
          accepted_by_user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          email: string;
          role?: Database['public']['Enums']['user_role'];
          invited_by_user_id?: string | null;
          invited_by_role?: string;
          invite_token: string;
          invite_token_expires_at?: string;
          accepted_at?: string | null;
          accepted_by_user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          email?: string;
          role?: Database['public']['Enums']['user_role'];
          invited_by_user_id?: string | null;
          invited_by_role?: string;
          invite_token?: string;
          invite_token_expires_at?: string;
          accepted_at?: string | null;
          accepted_by_user_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          full_name: string;
          role: Database['public']['Enums']['user_role'];
          avatar_url: string | null;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          email: string;
          full_name: string;
          role?: Database['public']['Enums']['user_role'];
          avatar_url?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          email?: string;
          full_name?: string;
          role?: Database['public']['Enums']['user_role'];
          avatar_url?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      app_tenant_id: { Args: Record<string, never>; Returns: string | null };
      is_super_admin: { Args: Record<string, never>; Returns: boolean };
      rpc_reorder_sessions: { Args: { p_ids: string[]; p_event_id: string }; Returns: void };
      tenant_max_file_size: { Args: { p_tenant_id: string }; Returns: number | null };
      tenant_max_devices_per_room: { Args: { p_tenant_id: string }; Returns: number | null };
      licensing_apply_quota: {
        Args: {
          p_license_key: string;
          p_tenant_id: string | null;
          p_plan: Database['public']['Enums']['tenant_plan'];
          p_storage_limit_bytes: number | null;
          p_max_rooms_per_event: number | null;
          p_max_devices_per_room: number | null;
          p_expires_at: string | null;
          p_status: string;
        };
        Returns: Json;
      };
      validate_upload_token: { Args: { p_token: string }; Returns: Json };
      init_upload_version: {
        Args: { p_token: string; p_filename: string; p_size: number; p_mime: string };
        Returns: Json;
      };
      finalize_upload_version: {
        Args: { p_token: string; p_version_id: string; p_sha256: string };
        Returns: Json;
      };
      abort_upload_version: {
        Args: { p_token: string; p_version_id: string };
        Returns: Json;
      };
      rpc_set_current_version: {
        Args: { p_presentation_id: string; p_version_id: string };
        Returns: Json;
      };
      rpc_update_presentation_status: {
        Args: { p_presentation_id: string; p_status: string; p_note: string | null };
        Returns: Json;
      };
      init_upload_version_admin: {
        Args: { p_speaker_id: string; p_filename: string; p_size: number; p_mime: string };
        Returns: Json;
      };
      finalize_upload_version_admin: {
        Args: { p_version_id: string; p_sha256: string };
        Returns: Json;
      };
      abort_upload_version_admin: {
        Args: { p_version_id: string };
        Returns: Json;
      };
      rpc_move_presentation: {
        Args: { p_presentation_id: string; p_target_speaker_id: string };
        Returns: Json;
      };
      rpc_move_presentation_to_session: {
        Args: { p_presentation_id: string; p_target_session_id: string };
        Returns: Json;
      };
      /** Sprint U-2: muove N presentations in folder atomicamente con tenant+event scope. */
      move_presentations_to_folder: {
        Args: { p_presentation_ids: string[]; p_folder_id: string | null };
        Returns: number;
      };
      rpc_room_player_set_current: {
        Args: {
          p_token: string;
          p_presentation_id: string | null;
          /** Sprint U-3: opzionale, indice 1-based slide corrente. */
          p_current_slide_index?: number | null;
          /** Sprint U-3: opzionale, totale slide del file in onda. */
          p_current_slide_total?: number | null;
        };
        Returns: Json;
      };
      init_upload_version_for_session: {
        Args: { p_session_id: string; p_filename: string; p_size: number; p_mime: string };
        Returns: Json;
      };
      delete_presentation_admin: {
        Args: { p_presentation_id: string };
        Returns: Json;
      };
      rename_paired_device_by_token: {
        Args: { p_token: string; p_name: string };
        Returns: Json;
      };
      mark_tenant_onboarded: { Args: Record<string, never>; Returns: string };
      reset_tenant_onboarding: { Args: Record<string, never>; Returns: void };
      seed_demo_data: { Args: Record<string, never>; Returns: Json };
      clear_demo_data: { Args: Record<string, never>; Returns: Json };
      tenant_health: { Args: Record<string, never>; Returns: Json };
      export_tenant_data: { Args: Record<string, never>; Returns: Json };
      tenant_storage_summary: { Args: Record<string, never>; Returns: Json };
      tenant_license_summary: { Args: Record<string, never>; Returns: Json };
      create_tenant_data_export: { Args: Record<string, never>; Returns: string };
      list_tenant_data_exports: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          requested_at: string;
          status: string;
          storage_path: string | null;
          byte_size: number | null;
          expires_at: string;
          ready_at: string | null;
          error_message: string | null;
        }[];
      };
      log_email_sent: {
        Args: {
          p_tenant_id: string;
          p_kind: string;
          p_recipient: string;
          p_idempotency_key: string;
          p_status: string;
          p_provider_message_id?: string | null;
          p_error_message?: string | null;
          p_metadata?: Json;
        };
        Returns: string;
      };
      list_tenants_for_license_warning: {
        Args: { p_days_min: number; p_days_max: number; p_email_kind: string };
        Returns: {
          tenant_id: string;
          tenant_name: string;
          admin_email: string;
          admin_full_name: string;
          expires_at: string;
          plan: string;
          days_remaining: number;
        }[];
      };
      expire_old_data_exports: { Args: Record<string, never>; Returns: number };
      list_tenant_activity: {
        Args: {
          p_from?: string | null;
          p_to?: string | null;
          p_action?: string | null;
          p_actor_id?: string | null;
          p_entity_type?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      admin_create_tenant_with_invite: {
        Args: {
          p_name: string;
          p_slug: string;
          p_plan: Database['public']['Enums']['tenant_plan'];
          p_storage_limit_bytes: number;
          p_max_events_per_month: number;
          p_max_rooms_per_event: number;
          p_max_devices_per_room: number;
          p_expires_at: string | null;
          p_license_key: string | null;
          p_admin_email: string;
          p_app_url: string;
        };
        Returns: Json;
      };
      record_lemon_squeezy_event: {
        Args: {
          p_event_id: string;
          p_event_name: string;
          p_subscription_id: string | null;
          p_customer_id: string | null;
          p_payload: Json;
        };
        Returns: Json;
      };
      mark_lemon_squeezy_event_processed: {
        Args: {
          p_log_id: string;
          p_status: 'processed' | 'skipped' | 'failed';
          p_tenant_id: string | null;
          p_error_message: string | null;
        };
        Returns: void;
      };
      lemon_squeezy_apply_subscription_event: {
        Args: {
          p_event_name: string;
          p_subscription_id: string;
          p_customer_id: string | null;
          p_variant_id: string;
          p_customer_email: string;
          p_customer_name: string | null;
          p_status: string;
          p_renews_at: string | null;
          p_ends_at: string | null;
          p_app_url: string;
        };
        Returns: Json;
      };
      // Sprint R-3 (G3): upload da PC sala (device_token auth, no JWT utente).
      // Chiamate SOLO dalle Edge Function room-device-upload-{init,finalize,abort}
      // (GRANT EXECUTE solo a service_role, NON a authenticated/anon).
      init_upload_version_for_room_device: {
        Args: {
          p_token: string;
          p_session_id: string;
          p_filename: string;
          p_size: number;
          p_mime: string;
        };
        Returns: Json;
      };
      finalize_upload_version_for_room_device: {
        Args: { p_token: string; p_version_id: string; p_sha256: string };
        Returns: Json;
      };
      abort_upload_version_for_room_device: {
        Args: { p_token: string; p_version_id: string };
        Returns: Json;
      };
      // Sprint S-4 (G7): promuove/demuove un device tra ruolo "room" e
      // "control_center". SECURITY INVOKER: rispetta RLS tenant_isolation.
      update_device_role: {
        Args: { p_device_id: string; p_new_role: 'room' | 'control_center' };
        Returns: { id: string; role: 'room' | 'control_center'; room_id: string | null }[];
      };
      /**
       * Sprint T-2 (G9) — ingest metric ping. Chiamata SOLO da Edge Function
       * `room-player-bootstrap` con service_role. Rate-limit 3s per device.
       */
      record_device_metric_ping: {
        Args: { p_device_id: string; p_payload: Record<string, unknown> };
        Returns: { ok: boolean; error?: string; skipped?: string };
      };
      /**
       * Sprint T-2 (G9) — admin live perf widget LivePerfTelemetryPanel.
       * Per ogni device dell'evento: ultimo ping + array ping ultimi N min.
       */
      fetch_device_metrics_for_event: {
        Args: {
          p_event_id: string;
          p_window_min?: number;
          p_max_pings_per_device?: number;
        };
        Returns: Array<{
          device: {
            id: string;
            name: string;
            role: 'room' | 'control_center';
            status: 'online' | 'offline' | 'degraded';
            room_id: string | null;
            last_seen_at: string | null;
            last_ip: string | null;
          };
          latest: Database['public']['Tables']['device_metric_pings']['Row'] | null;
          pings: Array<{
            ts: string;
            cpu_pct: number | null;
            ram_used_pct: number | null;
            js_heap_used_pct: number | null;
            storage_quota_used_pct: number | null;
            disk_free_pct: number | null;
            fps: number | null;
            battery_pct: number | null;
            battery_charging: boolean | null;
            network_type: string | null;
            visibility: 'visible' | 'hidden' | null;
          }>;
        }>;
      };
      /** Sprint T-2 — cleanup retention 24h, chiamato da pg_cron daily. */
      cleanup_device_metric_pings: {
        Args: Record<string, never>;
        Returns: number;
      };
      /**
       * Sprint T-3-A (G10) — scrittura idempotente warnings da Edge Function
       * `slide-validator`. SECURITY DEFINER + GRANT solo service_role.
       */
      record_validation_warnings: {
        Args: { p_version_id: string; p_warnings: ValidationWarning[] };
        Returns: { ok: boolean; skipped: boolean; reason?: string; warnings_count?: number };
      };
      /**
       * Sprint T-3-A (G10) — lista versions ready ancora non validate per una
       * sessione, usata dal hook `useValidationTrigger` per kick dell Edge.
       */
      list_unvalidated_versions_for_session: {
        Args: { p_session_id: string; p_limit?: number };
        Returns: Array<{
          version_id: string;
          presentation_id: string;
          file_name: string;
          storage_key: string;
        }>;
      };
      /**
       * Sprint T-3-G (G10) — crea un pairing telecomando. TTL minutes 5..10080
       * (5min..7gg, default 1440 = 24h). Solo tenant_admin del tenant target.
       * Ritorna il TOKEN IN CHIARO una sola volta — l'admin deve copiarlo
       * subito (DB conserva solo l'hash SHA-256).
       */
      rpc_create_remote_control_pairing: {
        Args: { p_room_id: string; p_name: string; p_ttl_minutes?: number };
        Returns: {
          ok: boolean;
          pairing_id: string;
          token: string;
          expires_at: string;
          room_id: string;
          event_id: string;
        };
      };
      /** Sprint T-3-G — revoca pairing (set revoked_at). Idempotente. */
      rpc_revoke_remote_control_pairing: {
        Args: { p_pairing_id: string };
        Returns: { ok: boolean; revoked_at?: string; already_revoked?: boolean };
      };
      /**
       * Sprint T-3-G — valida token telecomando. Anon-callable. Aggiorna
       * last_used_at. Lancia eccezione se token invalido/revocato/scaduto.
       */
      rpc_validate_remote_control_token: {
        Args: { p_token: string };
        Returns: {
          ok: boolean;
          pairing_id: string;
          tenant_id: string;
          event_id: string;
          room_id: string;
          name: string;
          expires_at: string;
          room_name: string | null;
          event_title: string | null;
        };
      };
      /**
       * Sprint T-3-G — scaletta sessione corrente per UI tablet remote.
       * Auth via token (anon-callable). Ordering allineato a getNextUpForRoom.
       */
      rpc_get_room_schedule_remote: {
        Args: { p_token: string };
        Returns: {
          ok: boolean;
          session_id: string | null;
          session_title: string | null;
          current_presentation_id: string | null;
          schedule: Array<{
            presentation_id: string;
            version_id: string;
            file_name: string;
            speaker_name: string | null;
            display_order: number | null;
          }>;
        };
      };
      /**
       * Sprint T-3-G — dispatch comando telecomando. Comandi: next | prev |
       * goto | blank | first. Rate-limit 60/min/pairing. Solo service_role
       * (chiamata da Edge Function `remote-control-dispatch`).
       */
      rpc_dispatch_remote_command: {
        Args: {
          p_token: string;
          p_command: 'next' | 'prev' | 'goto' | 'blank' | 'first';
          p_target_presentation_id?: string | null;
        };
        Returns: {
          ok: boolean;
          room_id: string;
          command: string;
          presentation_id: string | null;
          started_at: string | null;
        };
      };
      /** Sprint T-3-G — cleanup pairings scaduti da > N giorni. Solo super_admin. */
      purge_old_remote_control_pairings: {
        Args: { p_older_than_days?: number };
        Returns: { ok: boolean; deleted: number; cutoff: string };
      };
      /**
       * Sprint U-4 — magic link admin: genera token plain UNA volta sola.
       * `expires_minutes` 5..43200 (clamped), `max_uses` 1..10 (clamped).
       */
      rpc_admin_create_room_provision_token: {
        Args: {
          p_event_id: string;
          p_room_id: string;
          p_expires_minutes?: number | null;
          p_max_uses?: number | null;
          p_label?: string | null;
        };
        Returns: {
          id: string;
          token: string;
          expires_at: string;
          max_uses: number;
          tenant_id: string;
          event_id: string;
          room_id: string;
        };
      };
      /**
       * Sprint U-4 — consume del magic link da PC sala (anonimo, via Edge
       * Function `room-provision-claim`). Crea atomicamente un
       * `paired_devices` record. Errori granulari: token_invalid,
       * token_revoked, token_expired, token_exhausted.
       */
      rpc_consume_room_provision_token: {
        Args: {
          p_token: string;
          p_pair_token_hash: string;
          p_device_name?: string | null;
          p_device_type?: string | null;
          p_browser?: string | null;
          p_user_agent?: string | null;
          p_last_ip?: string | null;
        };
        Returns: {
          device_id: string;
          tenant_id: string;
          event_id: string;
          room_id: string;
          max_uses: number;
          consumed_count: number;
        };
      };
      /** Sprint U-4 — revoca un magic link attivo (admin-only). */
      rpc_admin_revoke_room_provision_token: {
        Args: { p_token_id: string };
        Returns: { ok: boolean; id: string };
      };
    };
    Enums: {
      actor_type: 'user' | 'speaker' | 'agent' | 'system' | 'device';
      connection_status: 'online' | 'offline' | 'degraded';
      event_status: 'draft' | 'setup' | 'active' | 'closed' | 'archived';
      network_mode: 'cloud' | 'intranet' | 'hybrid';
      playback_mode: 'auto' | 'live' | 'turbo';
      presentation_status: 'pending' | 'uploaded' | 'reviewed' | 'approved' | 'rejected';
      room_type: 'main' | 'breakout' | 'preview' | 'poster';
      session_type: 'talk' | 'panel' | 'workshop' | 'break' | 'ceremony';
      sync_status: 'synced' | 'syncing' | 'outdated' | 'offline';
      tenant_plan: 'trial' | 'starter' | 'pro' | 'enterprise';
      upload_source: 'web_portal' | 'preview_room' | 'agent_upload' | 'room_device';
      user_role: 'admin' | 'tech' | 'coordinator' | 'super_admin';
      version_status: 'uploading' | 'processing' | 'ready' | 'failed' | 'superseded';
    };
    CompositeTypes: Record<string, never>;
  };
};
