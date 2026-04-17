/**
 * Tipi schema `public` allineati alle migration in `supabase/migrations/`.
 * Quando Docker + `supabase db reset` sono disponibili, rigenerare con:
 *   npx supabase gen types typescript --local > packages/shared/src/types/database.ts
 * e ripristinare eventuali personalizzazioni documentate in guida §7.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

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
        };
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
        };
        Relationships: [];
      };
      presentations: {
        Row: {
          id: string;
          speaker_id: string;
          session_id: string;
          event_id: string;
          tenant_id: string;
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
          speaker_id: string;
          session_id: string;
          event_id: string;
          tenant_id: string;
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
          speaker_id?: string;
          session_id?: string;
          event_id?: string;
          tenant_id?: string;
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
      room_state: {
        Row: {
          room_id: string;
          tenant_id: string;
          current_session_id: string | null;
          current_presentation_id: string | null;
          current_version_id: string | null;
          sync_status: Database['public']['Enums']['sync_status'];
          agent_connection: Database['public']['Enums']['connection_status'];
          last_sync_at: string | null;
          assigned_agent_id: string | null;
          updated_at: string;
        };
        Insert: {
          room_id: string;
          tenant_id: string;
          current_session_id?: string | null;
          current_presentation_id?: string | null;
          current_version_id?: string | null;
          sync_status?: Database['public']['Enums']['sync_status'];
          agent_connection?: Database['public']['Enums']['connection_status'];
          last_sync_at?: string | null;
          assigned_agent_id?: string | null;
          updated_at?: string;
        };
        Update: {
          room_id?: string;
          tenant_id?: string;
          current_session_id?: string | null;
          current_presentation_id?: string | null;
          current_version_id?: string | null;
          sync_status?: Database['public']['Enums']['sync_status'];
          agent_connection?: Database['public']['Enums']['connection_status'];
          last_sync_at?: string | null;
          assigned_agent_id?: string | null;
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
          suspended: boolean;
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
          suspended?: boolean;
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
          suspended?: boolean;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      team_invitations: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          role: Database['public']['Enums']['user_role'];
          invited_by_user_id: string;
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
          invited_by_user_id: string;
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
          invited_by_user_id?: string;
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
    };
    Enums: {
      actor_type: 'user' | 'speaker' | 'agent' | 'system';
      connection_status: 'online' | 'offline' | 'degraded';
      event_status: 'draft' | 'setup' | 'active' | 'closed' | 'archived';
      network_mode: 'cloud' | 'intranet' | 'hybrid';
      presentation_status: 'pending' | 'uploaded' | 'reviewed' | 'approved' | 'rejected';
      room_type: 'main' | 'breakout' | 'preview' | 'poster';
      session_type: 'talk' | 'panel' | 'workshop' | 'break' | 'ceremony';
      sync_status: 'synced' | 'syncing' | 'outdated' | 'offline';
      tenant_plan: 'trial' | 'starter' | 'pro' | 'enterprise';
      upload_source: 'web_portal' | 'preview_room' | 'agent_upload';
      user_role: 'admin' | 'tech' | 'coordinator' | 'super_admin';
      version_status: 'uploading' | 'processing' | 'ready' | 'failed' | 'superseded';
    };
    CompositeTypes: Record<string, never>;
  };
};
