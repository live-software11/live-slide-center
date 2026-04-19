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
      activity_log: {
        Row: {
          action: string
          actor: Database["public"]["Enums"]["actor_type"]
          actor_id: string | null
          actor_name: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_id: string | null
          id: string
          metadata: Json | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor: Database["public"]["Enums"]["actor_type"]
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string | null
          id?: string
          metadata?: Json | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor?: Database["public"]["Enums"]["actor_type"]
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string | null
          id?: string
          metadata?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      desktop_devices: {
        Row: {
          app_version: string | null
          device_name: string
          id: string
          last_seen_at: string | null
          last_verified_at: string | null
          machine_fingerprint: string | null
          notes: string | null
          os_version: string | null
          pair_token_expires_at: string
          pair_token_hash: string
          registered_at: string
          registered_by_user_id: string | null
          revoked_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          app_version?: string | null
          device_name: string
          id?: string
          last_seen_at?: string | null
          last_verified_at?: string | null
          machine_fingerprint?: string | null
          notes?: string | null
          os_version?: string | null
          pair_token_expires_at?: string
          pair_token_hash: string
          registered_at?: string
          registered_by_user_id?: string | null
          revoked_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          app_version?: string | null
          device_name?: string
          id?: string
          last_seen_at?: string | null
          last_verified_at?: string | null
          machine_fingerprint?: string | null
          notes?: string | null
          os_version?: string | null
          pair_token_expires_at?: string
          pair_token_hash?: string
          registered_at?: string
          registered_by_user_id?: string | null
          revoked_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "desktop_devices_registered_by_user_id_fkey"
            columns: ["registered_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desktop_devices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      desktop_provision_tokens: {
        Row: {
          consumed_count: number
          created_at: string
          created_by_user_id: string | null
          expires_at: string
          id: string
          label: string | null
          max_uses: number
          revoked_at: string | null
          tenant_id: string
          token_hash: string
        }
        Insert: {
          consumed_count?: number
          created_at?: string
          created_by_user_id?: string | null
          expires_at: string
          id?: string
          label?: string | null
          max_uses?: number
          revoked_at?: string | null
          tenant_id: string
          token_hash: string
        }
        Update: {
          consumed_count?: number
          created_at?: string
          created_by_user_id?: string | null
          expires_at?: string
          id?: string
          label?: string | null
          max_uses?: number
          revoked_at?: string | null
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "desktop_provision_tokens_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desktop_provision_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      device_metric_pings: {
        Row: {
          app_uptime_sec: number | null
          battery_charging: boolean | null
          battery_pct: number | null
          cpu_pct: number | null
          device_id: string
          device_role: string | null
          disk_free_gb: number | null
          disk_free_pct: number | null
          event_id: string | null
          fps: number | null
          id: number
          js_heap_used_mb: number | null
          js_heap_used_pct: number | null
          network_downlink_mbps: number | null
          network_type: string | null
          playback_mode: string | null
          ram_used_mb: number | null
          ram_used_pct: number | null
          room_id: string | null
          source: string
          storage_quota_used_mb: number | null
          storage_quota_used_pct: number | null
          tenant_id: string
          ts: string
          visibility: string | null
        }
        Insert: {
          app_uptime_sec?: number | null
          battery_charging?: boolean | null
          battery_pct?: number | null
          cpu_pct?: number | null
          device_id: string
          device_role?: string | null
          disk_free_gb?: number | null
          disk_free_pct?: number | null
          event_id?: string | null
          fps?: number | null
          id?: number
          js_heap_used_mb?: number | null
          js_heap_used_pct?: number | null
          network_downlink_mbps?: number | null
          network_type?: string | null
          playback_mode?: string | null
          ram_used_mb?: number | null
          ram_used_pct?: number | null
          room_id?: string | null
          source: string
          storage_quota_used_mb?: number | null
          storage_quota_used_pct?: number | null
          tenant_id: string
          ts?: string
          visibility?: string | null
        }
        Update: {
          app_uptime_sec?: number | null
          battery_charging?: boolean | null
          battery_pct?: number | null
          cpu_pct?: number | null
          device_id?: string
          device_role?: string | null
          disk_free_gb?: number | null
          disk_free_pct?: number | null
          event_id?: string | null
          fps?: number | null
          id?: number
          js_heap_used_mb?: number | null
          js_heap_used_pct?: number | null
          network_downlink_mbps?: number | null
          network_type?: string | null
          playback_mode?: string | null
          ram_used_mb?: number | null
          ram_used_pct?: number | null
          room_id?: string | null
          source?: string
          storage_quota_used_mb?: number | null
          storage_quota_used_pct?: number | null
          tenant_id?: string
          ts?: string
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_metric_pings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "paired_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_metric_pings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_metric_pings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_metric_pings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      edge_function_rate_events: {
        Row: {
          created_at: string
          id: number
          ip_hash: string
          scope: string
        }
        Insert: {
          created_at?: string
          id?: number
          ip_hash: string
          scope: string
        }
        Update: {
          created_at?: string
          id?: number
          ip_hash?: string
          scope?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          error_message: string | null
          id: string
          idempotency_key: string
          kind: string
          metadata: Json
          provider_message_id: string | null
          recipient: string
          sent_at: string
          status: string
          tenant_id: string | null
        }
        Insert: {
          error_message?: string | null
          id?: string
          idempotency_key: string
          kind: string
          metadata?: Json
          provider_message_id?: string | null
          recipient: string
          sent_at?: string
          status?: string
          tenant_id?: string | null
        }
        Update: {
          error_message?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          metadata?: Json
          provider_message_id?: string | null
          recipient?: string
          sent_at?: string
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_folders: {
        Row: {
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          name: string
          parent_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          name: string
          parent_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          name?: string
          parent_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_folders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "event_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_folders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          location: string | null
          name: string
          name_en: string | null
          network_mode: Database["public"]["Enums"]["network_mode"]
          settings: Json
          start_date: string
          status: Database["public"]["Enums"]["event_status"]
          tenant_id: string
          timezone: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          location?: string | null
          name: string
          name_en?: string | null
          network_mode?: Database["public"]["Enums"]["network_mode"]
          settings?: Json
          start_date: string
          status?: Database["public"]["Enums"]["event_status"]
          tenant_id: string
          timezone?: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          location?: string | null
          name?: string
          name_en?: string | null
          network_mode?: Database["public"]["Enums"]["network_mode"]
          settings?: Json
          start_date?: string
          status?: Database["public"]["Enums"]["event_status"]
          tenant_id?: string
          timezone?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lemon_squeezy_event_log: {
        Row: {
          customer_id: string | null
          error_message: string | null
          event_id: string
          event_name: string
          id: string
          payload: Json
          processed_at: string | null
          processing_status: string
          received_at: string
          subscription_id: string | null
          tenant_id: string | null
        }
        Insert: {
          customer_id?: string | null
          error_message?: string | null
          event_id: string
          event_name: string
          id?: string
          payload: Json
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          subscription_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          customer_id?: string | null
          error_message?: string | null
          event_id?: string
          event_name?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          subscription_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lemon_squeezy_event_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lemon_squeezy_plan_mapping: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          max_devices_per_room: number
          max_events_per_month: number
          max_rooms_per_event: number
          notes: string | null
          plan: Database["public"]["Enums"]["tenant_plan"]
          storage_limit_bytes: number
          updated_at: string
          variant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          max_devices_per_room: number
          max_events_per_month: number
          max_rooms_per_event: number
          notes?: string | null
          plan: Database["public"]["Enums"]["tenant_plan"]
          storage_limit_bytes: number
          updated_at?: string
          variant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          max_devices_per_room?: number
          max_events_per_month?: number
          max_rooms_per_event?: number
          notes?: string | null
          plan?: Database["public"]["Enums"]["tenant_plan"]
          storage_limit_bytes?: number
          updated_at?: string
          variant_id?: string
        }
        Relationships: []
      }
      local_agents: {
        Row: {
          agent_version: string | null
          cached_files_count: number
          cached_size_bytes: number
          event_id: string
          id: string
          lan_ip: string | null
          lan_port: number
          last_heartbeat: string | null
          machine_id: string | null
          name: string
          registered_at: string
          status: Database["public"]["Enums"]["connection_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          agent_version?: string | null
          cached_files_count?: number
          cached_size_bytes?: number
          event_id: string
          id?: string
          lan_ip?: string | null
          lan_port?: number
          last_heartbeat?: string | null
          machine_id?: string | null
          name: string
          registered_at?: string
          status?: Database["public"]["Enums"]["connection_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          agent_version?: string | null
          cached_files_count?: number
          cached_size_bytes?: number
          event_id?: string
          id?: string
          lan_ip?: string | null
          lan_port?: number
          last_heartbeat?: string | null
          machine_id?: string | null
          name?: string
          registered_at?: string
          status?: Database["public"]["Enums"]["connection_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "local_agents_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "local_agents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pair_claim_rate_events: {
        Row: {
          created_at: string
          id: number
          ip_hash: string
        }
        Insert: {
          created_at?: string
          id?: never
          ip_hash: string
        }
        Update: {
          created_at?: string
          id?: never
          ip_hash?: string
        }
        Relationships: []
      }
      paired_devices: {
        Row: {
          browser: string | null
          device_name: string
          device_type: string | null
          event_id: string
          id: string
          last_ip: unknown
          last_seen_at: string | null
          notes: string | null
          pair_token_hash: string
          paired_at: string
          paired_by_user_id: string | null
          role: string
          room_id: string | null
          status: Database["public"]["Enums"]["connection_status"]
          tenant_id: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          browser?: string | null
          device_name: string
          device_type?: string | null
          event_id: string
          id?: string
          last_ip?: unknown
          last_seen_at?: string | null
          notes?: string | null
          pair_token_hash: string
          paired_at?: string
          paired_by_user_id?: string | null
          role?: string
          room_id?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          tenant_id: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          browser?: string | null
          device_name?: string
          device_type?: string | null
          event_id?: string
          id?: string
          last_ip?: unknown
          last_seen_at?: string | null
          notes?: string | null
          pair_token_hash?: string
          paired_at?: string
          paired_by_user_id?: string | null
          role?: string
          room_id?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          tenant_id?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paired_devices_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paired_devices_paired_by_user_id_fkey"
            columns: ["paired_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paired_devices_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paired_devices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pairing_codes: {
        Row: {
          code: string
          consumed_at: string | null
          consumed_by_device_id: string | null
          created_at: string
          event_id: string
          expires_at: string
          generated_by_user_id: string | null
          room_id: string | null
          tenant_id: string
        }
        Insert: {
          code: string
          consumed_at?: string | null
          consumed_by_device_id?: string | null
          created_at?: string
          event_id: string
          expires_at: string
          generated_by_user_id?: string | null
          room_id?: string | null
          tenant_id: string
        }
        Update: {
          code?: string
          consumed_at?: string | null
          consumed_by_device_id?: string | null
          created_at?: string
          event_id?: string
          expires_at?: string
          generated_by_user_id?: string | null
          room_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pairing_codes_consumed_by_device_id_fkey"
            columns: ["consumed_by_device_id"]
            isOneToOne: false
            referencedRelation: "paired_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairing_codes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairing_codes_generated_by_user_id_fkey"
            columns: ["generated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairing_codes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairing_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      presentation_versions: {
        Row: {
          created_at: string
          file_hash_sha256: string | null
          file_name: string
          file_size_bytes: number
          id: string
          mime_type: string
          notes: string | null
          presentation_id: string
          status: Database["public"]["Enums"]["version_status"]
          storage_key: string
          tenant_id: string
          upload_source: Database["public"]["Enums"]["upload_source"]
          uploaded_by_speaker: boolean
          uploaded_by_user_id: string | null
          validated_at: string | null
          validation_warnings: Json | null
          version_number: number
        }
        Insert: {
          created_at?: string
          file_hash_sha256?: string | null
          file_name: string
          file_size_bytes: number
          id?: string
          mime_type: string
          notes?: string | null
          presentation_id: string
          status?: Database["public"]["Enums"]["version_status"]
          storage_key: string
          tenant_id: string
          upload_source?: Database["public"]["Enums"]["upload_source"]
          uploaded_by_speaker?: boolean
          uploaded_by_user_id?: string | null
          validated_at?: string | null
          validation_warnings?: Json | null
          version_number: number
        }
        Update: {
          created_at?: string
          file_hash_sha256?: string | null
          file_name?: string
          file_size_bytes?: number
          id?: string
          mime_type?: string
          notes?: string | null
          presentation_id?: string
          status?: Database["public"]["Enums"]["version_status"]
          storage_key?: string
          tenant_id?: string
          upload_source?: Database["public"]["Enums"]["upload_source"]
          uploaded_by_speaker?: boolean
          uploaded_by_user_id?: string | null
          validated_at?: string | null
          validation_warnings?: Json | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "presentation_versions_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentation_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentation_versions_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      presentations: {
        Row: {
          created_at: string
          current_version_id: string | null
          event_id: string
          folder_id: string | null
          id: string
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          reviewer_note: string | null
          session_id: string
          speaker_id: string | null
          status: Database["public"]["Enums"]["presentation_status"]
          tenant_id: string
          total_versions: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_version_id?: string | null
          event_id: string
          folder_id?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          reviewer_note?: string | null
          session_id: string
          speaker_id?: string | null
          status?: Database["public"]["Enums"]["presentation_status"]
          tenant_id: string
          total_versions?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_version_id?: string | null
          event_id?: string
          folder_id?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          reviewer_note?: string | null
          session_id?: string
          speaker_id?: string | null
          status?: Database["public"]["Enums"]["presentation_status"]
          tenant_id?: string
          total_versions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_current_version"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "presentation_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentations_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "event_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentations_reviewed_by_user_id_fkey"
            columns: ["reviewed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentations_speaker_id_fkey"
            columns: ["speaker_id"]
            isOneToOne: false
            referencedRelation: "speakers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      remote_control_pairings: {
        Row: {
          commands_count: number
          created_at: string
          created_by_user_id: string | null
          event_id: string
          expires_at: string
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          room_id: string
          tenant_id: string
          token_hash: string
        }
        Insert: {
          commands_count?: number
          created_at?: string
          created_by_user_id?: string | null
          event_id: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          room_id: string
          tenant_id: string
          token_hash: string
        }
        Update: {
          commands_count?: number
          created_at?: string
          created_by_user_id?: string | null
          event_id?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          room_id?: string
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "remote_control_pairings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remote_control_pairings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remote_control_pairings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      remote_control_rate_events: {
        Row: {
          created_at: string
          id: number
          pairing_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          pairing_id: string
        }
        Update: {
          created_at?: string
          id?: number
          pairing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "remote_control_rate_events_pairing_id_fkey"
            columns: ["pairing_id"]
            isOneToOne: false
            referencedRelation: "remote_control_pairings"
            referencedColumns: ["id"]
          },
        ]
      }
      room_provision_tokens: {
        Row: {
          consumed_count: number
          created_at: string
          created_by_user_id: string | null
          event_id: string
          expires_at: string
          id: string
          label: string | null
          max_uses: number
          revoked_at: string | null
          room_id: string
          tenant_id: string
          token_hash: string
        }
        Insert: {
          consumed_count?: number
          created_at?: string
          created_by_user_id?: string | null
          event_id: string
          expires_at: string
          id?: string
          label?: string | null
          max_uses?: number
          revoked_at?: string | null
          room_id: string
          tenant_id: string
          token_hash: string
        }
        Update: {
          consumed_count?: number
          created_at?: string
          created_by_user_id?: string | null
          event_id?: string
          expires_at?: string
          id?: string
          label?: string | null
          max_uses?: number
          revoked_at?: string | null
          room_id?: string
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_provision_tokens_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_provision_tokens_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_provision_tokens_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_provision_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      room_state: {
        Row: {
          agent_connection: Database["public"]["Enums"]["connection_status"]
          assigned_agent_id: string | null
          current_presentation_id: string | null
          current_session_id: string | null
          current_slide_index: number | null
          current_slide_total: number | null
          current_version_id: string | null
          last_play_started_at: string | null
          last_sync_at: string | null
          playback_mode: Database["public"]["Enums"]["playback_mode"]
          room_id: string
          sync_status: Database["public"]["Enums"]["sync_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          agent_connection?: Database["public"]["Enums"]["connection_status"]
          assigned_agent_id?: string | null
          current_presentation_id?: string | null
          current_session_id?: string | null
          current_slide_index?: number | null
          current_slide_total?: number | null
          current_version_id?: string | null
          last_play_started_at?: string | null
          last_sync_at?: string | null
          playback_mode?: Database["public"]["Enums"]["playback_mode"]
          room_id: string
          sync_status?: Database["public"]["Enums"]["sync_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          agent_connection?: Database["public"]["Enums"]["connection_status"]
          assigned_agent_id?: string | null
          current_presentation_id?: string | null
          current_session_id?: string | null
          current_slide_index?: number | null
          current_slide_total?: number | null
          current_version_id?: string | null
          last_play_started_at?: string | null
          last_sync_at?: string | null
          playback_mode?: Database["public"]["Enums"]["playback_mode"]
          room_id?: string
          sync_status?: Database["public"]["Enums"]["sync_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_state_current_presentation_id_fkey"
            columns: ["current_presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_state_current_session_id_fkey"
            columns: ["current_session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_state_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "presentation_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_state_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          capacity: number | null
          created_at: string
          display_order: number
          event_id: string
          floor: string | null
          id: string
          name: string
          name_en: string | null
          room_type: Database["public"]["Enums"]["room_type"]
          settings: Json
          tenant_id: string
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          display_order?: number
          event_id: string
          floor?: string | null
          id?: string
          name: string
          name_en?: string | null
          room_type?: Database["public"]["Enums"]["room_type"]
          settings?: Json
          tenant_id: string
        }
        Update: {
          capacity?: number | null
          created_at?: string
          display_order?: number
          event_id?: string
          floor?: string | null
          id?: string
          name?: string
          name_en?: string | null
          room_type?: Database["public"]["Enums"]["room_type"]
          settings?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          chair_name: string | null
          created_at: string
          display_order: number
          event_id: string
          id: string
          notes: string | null
          room_id: string
          scheduled_end: string
          scheduled_start: string
          session_type: Database["public"]["Enums"]["session_type"]
          tenant_id: string
          title: string
          title_en: string | null
          updated_at: string
        }
        Insert: {
          chair_name?: string | null
          created_at?: string
          display_order?: number
          event_id: string
          id?: string
          notes?: string | null
          room_id: string
          scheduled_end: string
          scheduled_start: string
          session_type?: Database["public"]["Enums"]["session_type"]
          tenant_id: string
          title: string
          title_en?: string | null
          updated_at?: string
        }
        Update: {
          chair_name?: string | null
          created_at?: string
          display_order?: number
          event_id?: string
          id?: string
          notes?: string | null
          room_id?: string
          scheduled_end?: string
          scheduled_start?: string
          session_type?: Database["public"]["Enums"]["session_type"]
          tenant_id?: string
          title?: string
          title_en?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      speakers: {
        Row: {
          bio: string | null
          company: string | null
          created_at: string
          display_order: number
          email: string | null
          event_id: string
          full_name: string
          id: string
          job_title: string | null
          session_id: string
          tenant_id: string
          upload_token: string | null
          upload_token_expires_at: string | null
        }
        Insert: {
          bio?: string | null
          company?: string | null
          created_at?: string
          display_order?: number
          email?: string | null
          event_id: string
          full_name: string
          id?: string
          job_title?: string | null
          session_id: string
          tenant_id: string
          upload_token?: string | null
          upload_token_expires_at?: string | null
        }
        Update: {
          bio?: string | null
          company?: string | null
          created_at?: string
          display_order?: number
          email?: string | null
          event_id?: string
          full_name?: string
          id?: string
          job_title?: string | null
          session_id?: string
          tenant_id?: string
          upload_token?: string | null
          upload_token_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "speakers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speakers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speakers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          created_at: string
          email: string
          id: string
          invite_token: string
          invite_token_expires_at: string
          invited_by_role: string
          invited_by_user_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          tenant_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          email: string
          id?: string
          invite_token: string
          invite_token_expires_at?: string
          invited_by_role?: string
          invited_by_user_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          email?: string
          id?: string
          invite_token?: string
          invite_token_expires_at?: string
          invited_by_role?: string
          invited_by_user_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_accepted_by_user_id_fkey"
            columns: ["accepted_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invitations_invited_by_user_id_fkey"
            columns: ["invited_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_data_exports: {
        Row: {
          byte_size: number | null
          error_message: string | null
          expires_at: string
          id: string
          ready_at: string | null
          requested_at: string
          requested_by_user_id: string
          status: string
          storage_path: string | null
          tenant_id: string
        }
        Insert: {
          byte_size?: number | null
          error_message?: string | null
          expires_at?: string
          id?: string
          ready_at?: string | null
          requested_at?: string
          requested_by_user_id: string
          status?: string
          storage_path?: string | null
          tenant_id: string
        }
        Update: {
          byte_size?: number | null
          error_message?: string | null
          expires_at?: string
          id?: string
          ready_at?: string | null
          requested_at?: string
          requested_by_user_id?: string
          status?: string
          storage_path?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_data_exports_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_data_exports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          lemon_squeezy_customer_id: string | null
          lemon_squeezy_subscription_id: string | null
          lemon_squeezy_variant_id: string | null
          license_key: string | null
          license_synced_at: string | null
          ls_customer_id: string | null
          ls_subscription_id: string | null
          max_active_events: number | null
          max_devices_per_event: number
          max_devices_per_room: number
          max_events_per_month: number
          max_rooms_per_event: number
          name: string
          onboarded_at: string | null
          plan: Database["public"]["Enums"]["tenant_plan"]
          settings: Json
          slug: string
          storage_limit_bytes: number
          storage_used_bytes: number
          suspended: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          lemon_squeezy_customer_id?: string | null
          lemon_squeezy_subscription_id?: string | null
          lemon_squeezy_variant_id?: string | null
          license_key?: string | null
          license_synced_at?: string | null
          ls_customer_id?: string | null
          ls_subscription_id?: string | null
          max_active_events?: number | null
          max_devices_per_event?: number
          max_devices_per_room?: number
          max_events_per_month?: number
          max_rooms_per_event?: number
          name: string
          onboarded_at?: string | null
          plan?: Database["public"]["Enums"]["tenant_plan"]
          settings?: Json
          slug: string
          storage_limit_bytes?: number
          storage_used_bytes?: number
          suspended?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          lemon_squeezy_customer_id?: string | null
          lemon_squeezy_subscription_id?: string | null
          lemon_squeezy_variant_id?: string | null
          license_key?: string | null
          license_synced_at?: string | null
          ls_customer_id?: string | null
          ls_subscription_id?: string | null
          max_active_events?: number | null
          max_devices_per_event?: number
          max_devices_per_room?: number
          max_events_per_month?: number
          max_rooms_per_event?: number
          name?: string
          onboarded_at?: string | null
          plan?: Database["public"]["Enums"]["tenant_plan"]
          settings?: Json
          slug?: string
          storage_limit_bytes?: number
          storage_used_bytes?: number
          suspended?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          last_seen_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          last_seen_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          last_seen_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      tenant_network_map: {
        Row: {
          app_version: string | null
          derived_status: string | null
          display_name: string | null
          event_id: string | null
          kind: string | null
          last_seen_at: string | null
          machine_fingerprint: string | null
          node_id: string | null
          raw_status: string | null
          registered_at: string | null
          role: string | null
          room_id: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      abort_upload_version: {
        Args: { p_token: string; p_version_id: string }
        Returns: Json
      }
      abort_upload_version_admin: {
        Args: { p_version_id: string }
        Returns: Json
      }
      abort_upload_version_for_room_device: {
        Args: { p_token: string; p_version_id: string }
        Returns: Json
      }
      admin_create_tenant_with_invite: {
        Args: {
          p_admin_email: string
          p_app_url: string
          p_expires_at: string
          p_license_key: string
          p_max_devices_per_room: number
          p_max_events_per_month: number
          p_max_rooms_per_event: number
          p_name: string
          p_plan: Database["public"]["Enums"]["tenant_plan"]
          p_slug: string
          p_storage_limit_bytes: number
        }
        Returns: Json
      }
      app_tenant_id: { Args: never; Returns: string }
      app_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      check_and_record_edge_rate: {
        Args: {
          p_ip_hash: string
          p_max_per_window: number
          p_scope: string
          p_window_minutes: number
        }
        Returns: Json
      }
      claim_pairing_code_atomic: {
        Args: {
          p_browser: string
          p_code: string
          p_device_name: string
          p_device_type: string
          p_last_ip: string
          p_token_hash: string
          p_user_agent: string
        }
        Returns: Json
      }
      cleanup_device_metric_pings: { Args: never; Returns: number }
      cleanup_lemon_squeezy_event_log: { Args: never; Returns: number }
      cleanup_pair_claim_rate_events: { Args: never; Returns: number }
      clear_demo_data: { Args: never; Returns: Json }
      create_tenant_data_export: { Args: never; Returns: string }
      current_tenant_suspended: { Args: never; Returns: boolean }
      delete_presentation_admin: {
        Args: { p_presentation_id: string }
        Returns: Json
      }
      expire_old_data_exports: { Args: never; Returns: number }
      export_tenant_data: { Args: never; Returns: Json }
      fetch_device_metrics_for_event: {
        Args: {
          p_event_id: string
          p_max_pings_per_device?: number
          p_window_min?: number
        }
        Returns: Json
      }
      finalize_upload_version: {
        Args: { p_sha256: string; p_token: string; p_version_id: string }
        Returns: Json
      }
      finalize_upload_version_admin: {
        Args: { p_sha256: string; p_version_id: string }
        Returns: Json
      }
      finalize_upload_version_for_room_device: {
        Args: { p_sha256: string; p_token: string; p_version_id: string }
        Returns: Json
      }
      has_tenant_admin_role: { Args: never; Returns: boolean }
      init_upload_version: {
        Args: {
          p_filename: string
          p_mime: string
          p_size: number
          p_token: string
        }
        Returns: Json
      }
      init_upload_version_admin: {
        Args: {
          p_filename: string
          p_mime: string
          p_size: number
          p_speaker_id: string
        }
        Returns: Json
      }
      init_upload_version_for_room_device: {
        Args: {
          p_filename: string
          p_mime: string
          p_session_id: string
          p_size: number
          p_token: string
        }
        Returns: Json
      }
      init_upload_version_for_session: {
        Args: {
          p_filename: string
          p_mime: string
          p_session_id: string
          p_size: number
        }
        Returns: Json
      }
      is_super_admin: { Args: never; Returns: boolean }
      lemon_squeezy_apply_subscription_event: {
        Args: {
          p_app_url: string
          p_customer_email: string
          p_customer_id: string
          p_customer_name: string
          p_ends_at: string
          p_event_name: string
          p_renews_at: string
          p_status: string
          p_subscription_id: string
          p_variant_id: string
        }
        Returns: Json
      }
      licensing_apply_quota: {
        Args: {
          p_expires_at: string
          p_license_key: string
          p_max_active_events?: number | null
          p_max_devices_per_room: number
          p_max_rooms_per_event: number
          p_plan: Database["public"]["Enums"]["tenant_plan"]
          p_status: string
          p_storage_limit_bytes: number
          p_tenant_id: string
        }
        Returns: Json
      }
      list_tenant_activity: {
        Args: {
          p_action?: string
          p_actor_id?: string
          p_entity_type?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_to?: string
        }
        Returns: Json
      }
      list_tenant_data_exports: {
        Args: never
        Returns: {
          byte_size: number
          error_message: string
          expires_at: string
          id: string
          ready_at: string
          requested_at: string
          status: string
          storage_path: string
        }[]
      }
      list_tenants_for_license_warning: {
        Args: { p_days_max: number; p_days_min: number; p_email_kind: string }
        Returns: {
          admin_email: string
          admin_full_name: string
          days_remaining: number
          expires_at: string
          plan: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      list_unvalidated_versions_for_session: {
        Args: { p_limit?: number; p_session_id: string }
        Returns: {
          file_name: string
          presentation_id: string
          storage_key: string
          version_id: string
        }[]
      }
      log_email_sent: {
        Args: {
          p_error_message?: string
          p_idempotency_key: string
          p_kind: string
          p_metadata?: Json
          p_provider_message_id?: string
          p_recipient: string
          p_status: string
          p_tenant_id: string
        }
        Returns: string
      }
      mark_lemon_squeezy_event_processed: {
        Args: {
          p_error_message: string
          p_log_id: string
          p_status: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      mark_tenant_onboarded: { Args: never; Returns: string }
      move_presentations_to_folder: {
        Args: { p_folder_id: string; p_presentation_ids: string[] }
        Returns: number
      }
      purge_old_remote_control_pairings: {
        Args: { p_older_than_days?: number }
        Returns: Json
      }
      record_device_metric_ping: {
        Args: { p_device_id: string; p_payload: Json }
        Returns: Json
      }
      record_lemon_squeezy_event: {
        Args: {
          p_customer_id: string
          p_event_id: string
          p_event_name: string
          p_payload: Json
          p_subscription_id: string
        }
        Returns: Json
      }
      record_validation_warnings: {
        Args: { p_version_id: string; p_warnings: Json }
        Returns: Json
      }
      rename_paired_device_by_token: {
        Args: { p_name: string; p_token: string }
        Returns: Json
      }
      rename_presentation_version_file_name: {
        Args: { p_new_name: string; p_version_id: string }
        Returns: Json
      }
      reset_tenant_onboarding: { Args: never; Returns: undefined }
      rpc_admin_create_desktop_provision_token: {
        Args: {
          p_expires_minutes?: number
          p_label?: string
          p_max_uses?: number
        }
        Returns: Json
      }
      rpc_admin_create_room_provision_token: {
        Args: {
          p_event_id: string
          p_expires_minutes?: number
          p_label?: string
          p_max_uses?: number
          p_room_id: string
        }
        Returns: Json
      }
      rpc_admin_extend_desktop_token: {
        Args: { p_device_id: string; p_extra_months?: number }
        Returns: Json
      }
      rpc_admin_list_expiring_desktop_devices: {
        Args: { p_days_max: number; p_days_min: number; p_email_kind: string }
        Returns: {
          admin_email: string
          admin_full_name: string
          days_remaining: number
          device_id: string
          device_name: string
          machine_fingerprint: string
          pair_token_expires_at: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      rpc_admin_move_paired_device: {
        Args: {
          p_device_id: string
          p_target_event_id: string
          p_target_room_id?: string
        }
        Returns: Json
      }
      rpc_admin_revoke_desktop_device: {
        Args: { p_device_id: string }
        Returns: Json
      }
      rpc_admin_revoke_desktop_provision_token: {
        Args: { p_token_id: string }
        Returns: Json
      }
      rpc_admin_revoke_room_provision_token: {
        Args: { p_token_id: string }
        Returns: Json
      }
      rpc_consume_desktop_provision_token: {
        Args: {
          p_app_version?: string
          p_device_name?: string
          p_machine_fingerprint?: string
          p_os_version?: string
          p_pair_token_hash: string
          p_token: string
        }
        Returns: Json
      }
      rpc_consume_room_provision_token: {
        Args: {
          p_browser?: string
          p_device_name?: string
          p_device_type?: string
          p_last_ip?: string
          p_pair_token_hash: string
          p_token: string
          p_user_agent?: string
        }
        Returns: Json
      }
      rpc_create_remote_control_pairing: {
        Args: { p_name: string; p_room_id: string; p_ttl_minutes?: number }
        Returns: Json
      }
      rpc_desktop_license_verify: {
        Args: { p_app_version?: string; p_pair_token_hash: string }
        Returns: Json
      }
      rpc_desktop_renew_token: {
        Args: { p_new_pair_token_hash: string; p_old_pair_token_hash: string }
        Returns: Json
      }
      rpc_dispatch_remote_command: {
        Args: {
          p_command: string
          p_target_presentation_id?: string
          p_token: string
        }
        Returns: Json
      }
      rpc_get_room_schedule_remote: { Args: { p_token: string }; Returns: Json }
      rpc_move_presentation: {
        Args: { p_presentation_id: string; p_target_speaker_id: string }
        Returns: Json
      }
      rpc_move_presentation_to_session: {
        Args: { p_presentation_id: string; p_target_session_id: string }
        Returns: Json
      }
      rpc_reorder_sessions: {
        Args: { p_event_id: string; p_ids: string[] }
        Returns: undefined
      }
      rpc_revoke_pair_self: {
        Args: { p_pair_token_hash: string }
        Returns: Json
      }
      rpc_revoke_remote_control_pairing: {
        Args: { p_pairing_id: string }
        Returns: Json
      }
      rpc_room_player_set_current: {
        Args: {
          p_current_slide_index?: number
          p_current_slide_total?: number
          p_presentation_id: string
          p_token: string
        }
        Returns: Json
      }
      rpc_set_current_version: {
        Args: { p_presentation_id: string; p_version_id: string }
        Returns: Json
      }
      rpc_update_presentation_status: {
        Args: { p_note: string; p_presentation_id: string; p_status: string }
        Returns: Json
      }
      rpc_validate_remote_control_token: {
        Args: { p_token: string }
        Returns: Json
      }
      seed_demo_data: { Args: never; Returns: Json }
      tenant_health: { Args: never; Returns: Json }
      tenant_license_summary: { Args: never; Returns: Json }
      tenant_max_devices_per_room: {
        Args: { p_tenant_id: string }
        Returns: number
      }
      tenant_max_file_size: { Args: { p_tenant_id: string }; Returns: number }
      tenant_storage_summary: { Args: never; Returns: Json }
      update_device_role: {
        Args: { p_device_id: string; p_new_role: string }
        Returns: {
          id: string
          role: string
          room_id: string
        }[]
      }
      validate_upload_token: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      actor_type: "user" | "speaker" | "agent" | "system" | "device"
      connection_status: "online" | "offline" | "degraded"
      event_status: "draft" | "setup" | "active" | "closed" | "archived"
      network_mode: "cloud" | "intranet" | "hybrid"
      playback_mode: "auto" | "live" | "turbo"
      presentation_status:
      | "pending"
      | "uploaded"
      | "reviewed"
      | "approved"
      | "rejected"
      room_type: "main" | "breakout" | "preview" | "poster"
      session_type: "talk" | "panel" | "workshop" | "break" | "ceremony"
      sync_status: "synced" | "syncing" | "outdated" | "offline"
      tenant_plan: "trial" | "starter" | "pro" | "enterprise"
      upload_source:
      | "web_portal"
      | "preview_room"
      | "agent_upload"
      | "room_device"
      user_role: "admin" | "tech" | "coordinator" | "super_admin"
      version_status:
      | "uploading"
      | "processing"
      | "ready"
      | "failed"
      | "superseded"
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
      actor_type: ["user", "speaker", "agent", "system", "device"],
      connection_status: ["online", "offline", "degraded"],
      event_status: ["draft", "setup", "active", "closed", "archived"],
      network_mode: ["cloud", "intranet", "hybrid"],
      playback_mode: ["auto", "live", "turbo"],
      presentation_status: [
        "pending",
        "uploaded",
        "reviewed",
        "approved",
        "rejected",
      ],
      room_type: ["main", "breakout", "preview", "poster"],
      session_type: ["talk", "panel", "workshop", "break", "ceremony"],
      sync_status: ["synced", "syncing", "outdated", "offline"],
      tenant_plan: ["trial", "starter", "pro", "enterprise"],
      upload_source: [
        "web_portal",
        "preview_room",
        "agent_upload",
        "room_device",
      ],
      user_role: ["admin", "tech", "coordinator", "super_admin"],
      version_status: [
        "uploading",
        "processing",
        "ready",
        "failed",
        "superseded",
      ],
    },
  },
} as const
