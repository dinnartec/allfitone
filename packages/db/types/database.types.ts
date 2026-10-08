export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  access_control: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      account: { Args: never; Returns: string }
      actor_kind: {
        Args: never
        Returns: Database['identity']['Enums']['actor_kind']
      }
      can_read_membership_event: {
        Args: { p_membership_id: string }
        Returns: boolean
      }
      counts_platform_metrics: { Args: never; Returns: boolean }
      has_capability: {
        Args: { p_capability_code: string; p_organization_id: string }
        Returns: boolean
      }
      has_membership: { Args: { p_organization_id: string }; Returns: boolean }
      has_platform_duty: {
        Args: { p_duty_code: string; p_person_id: string; p_session_id: string }
        Returns: boolean
      }
      has_platform_role: {
        Args: {
          p_person_id: string
          p_platform_role: string
          p_session_id: string
        }
        Returns: boolean
      }
      holds_backoffice_duty: { Args: { p_duty_code: string }; Returns: boolean }
      is_self: { Args: { target_person_id: string }; Returns: boolean }
      org: { Args: never; Returns: string }
      owns_membership: { Args: { p_membership_id: string }; Returns: boolean }
      person: { Args: never; Returns: string }
      reads_under_break_glass: {
        Args: { p_category: string; p_subject_person_id: string }
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
  catalog: {
    Tables: {
      activity_type_result_contracts: {
        Row: {
          activity_type_id: string
          id: string
          is_default: boolean
          result_contract_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          activity_type_id: string
          id?: string
          is_default?: boolean
          result_contract_id: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          activity_type_id?: string
          id?: string
          is_default?: boolean
          result_contract_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_activity_type_result_contracts_activity_type'
            columns: ['activity_type_id']
            isOneToOne: false
            referencedRelation: 'activity_types'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_activity_type_result_contracts_result_contract'
            columns: ['result_contract_id']
            isOneToOne: false
            referencedRelation: 'result_contracts'
            referencedColumns: ['id']
          },
        ]
      }
      activity_types: {
        Row: {
          code: string
          content_scope: Database['catalog']['Enums']['content_scope']
          created_at: string
          discipline_code: string
          id: string
          name: string
          owner_organization_id: string | null
          status: Database['catalog']['Enums']['publication_status']
        }
        Insert: {
          code: string
          content_scope?: Database['catalog']['Enums']['content_scope']
          created_at?: string
          discipline_code: string
          id?: string
          name: string
          owner_organization_id?: string | null
          status?: Database['catalog']['Enums']['publication_status']
        }
        Update: {
          code?: string
          content_scope?: Database['catalog']['Enums']['content_scope']
          created_at?: string
          discipline_code?: string
          id?: string
          name?: string
          owner_organization_id?: string | null
          status?: Database['catalog']['Enums']['publication_status']
        }
        Relationships: [
          {
            foreignKeyName: 'fk_activity_types_discipline'
            columns: ['discipline_code']
            isOneToOne: false
            referencedRelation: 'disciplines'
            referencedColumns: ['code']
          },
        ]
      }
      contract_fixtures: {
        Row: {
          expected: string
          id: string
          kind: string
          payload: Json
          payload_schema_version: number
          result_contract_id: string
        }
        Insert: {
          expected: string
          id?: string
          kind: string
          payload: Json
          payload_schema_version?: number
          result_contract_id: string
        }
        Update: {
          expected?: string
          id?: string
          kind?: string
          payload?: Json
          payload_schema_version?: number
          result_contract_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_contract_fixtures_result_contract'
            columns: ['result_contract_id']
            isOneToOne: false
            referencedRelation: 'result_contracts'
            referencedColumns: ['id']
          },
        ]
      }
      disciplines: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          status: Database['catalog']['Enums']['publication_status']
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          status?: Database['catalog']['Enums']['publication_status']
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          status?: Database['catalog']['Enums']['publication_status']
        }
        Relationships: []
      }
      equipment: {
        Row: {
          code: string | null
          content_scope: Database['catalog']['Enums']['content_scope']
          created_at: string
          display_order: number
          id: string
          name: string
          owner_organization_id: string | null
          status: Database['catalog']['Enums']['publication_status']
        }
        Insert: {
          code?: string | null
          content_scope: Database['catalog']['Enums']['content_scope']
          created_at?: string
          display_order?: number
          id?: string
          name: string
          owner_organization_id?: string | null
          status?: Database['catalog']['Enums']['publication_status']
        }
        Update: {
          code?: string | null
          content_scope?: Database['catalog']['Enums']['content_scope']
          created_at?: string
          display_order?: number
          id?: string
          name?: string
          owner_organization_id?: string | null
          status?: Database['catalog']['Enums']['publication_status']
        }
        Relationships: []
      }
      movement_aliases: {
        Row: {
          id: string
          locale: string
          movement_id: string
          name: string
        }
        Insert: {
          id?: string
          locale?: string
          movement_id: string
          name: string
        }
        Update: {
          id?: string
          locale?: string
          movement_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_movement_aliases_movement'
            columns: ['movement_id']
            isOneToOne: false
            referencedRelation: 'movements'
            referencedColumns: ['id']
          },
        ]
      }
      movement_equipment: {
        Row: {
          equipment_id: string
          id: string
          movement_id: string
          requirement: string
        }
        Insert: {
          equipment_id: string
          id?: string
          movement_id: string
          requirement?: string
        }
        Update: {
          equipment_id?: string
          id?: string
          movement_id?: string
          requirement?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_movement_equipment_equipment'
            columns: ['equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_movement_equipment_movement'
            columns: ['movement_id']
            isOneToOne: false
            referencedRelation: 'movements'
            referencedColumns: ['id']
          },
        ]
      }
      movement_instructions: {
        Row: {
          id: string
          locale: string
          movement_id: string
          position: number
          text: string
        }
        Insert: {
          id?: string
          locale?: string
          movement_id: string
          position: number
          text: string
        }
        Update: {
          id?: string
          locale?: string
          movement_id?: string
          position?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_movement_instructions_movement'
            columns: ['movement_id']
            isOneToOne: false
            referencedRelation: 'movements'
            referencedColumns: ['id']
          },
        ]
      }
      movement_media: {
        Row: {
          byte_size: number
          checksum: string
          content_type: string
          height: number
          id: string
          kind: string
          movement_id: string
          object_key: string
          width: number
        }
        Insert: {
          byte_size: number
          checksum: string
          content_type: string
          height: number
          id?: string
          kind?: string
          movement_id: string
          object_key: string
          width: number
        }
        Update: {
          byte_size?: number
          checksum?: string
          content_type?: string
          height?: number
          id?: string
          kind?: string
          movement_id?: string
          object_key?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_movement_media_movement'
            columns: ['movement_id']
            isOneToOne: false
            referencedRelation: 'movements'
            referencedColumns: ['id']
          },
        ]
      }
      movement_muscles: {
        Row: {
          id: string
          is_primary: boolean
          movement_id: string
          muscle_id: string
        }
        Insert: {
          id?: string
          is_primary?: boolean
          movement_id: string
          muscle_id: string
        }
        Update: {
          id?: string
          is_primary?: boolean
          movement_id?: string
          muscle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_movement_muscles_movement'
            columns: ['movement_id']
            isOneToOne: false
            referencedRelation: 'movements'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_movement_muscles_muscle'
            columns: ['muscle_id']
            isOneToOne: false
            referencedRelation: 'muscles'
            referencedColumns: ['id']
          },
        ]
      }
      movement_variants: {
        Row: {
          base_movement_id: string
          id: string
          note: string | null
          relation: string
          variant_movement_id: string
        }
        Insert: {
          base_movement_id: string
          id?: string
          note?: string | null
          relation?: string
          variant_movement_id: string
        }
        Update: {
          base_movement_id?: string
          id?: string
          note?: string | null
          relation?: string
          variant_movement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_movement_variants_base'
            columns: ['base_movement_id']
            isOneToOne: false
            referencedRelation: 'movements'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_movement_variants_variant'
            columns: ['variant_movement_id']
            isOneToOne: false
            referencedRelation: 'movements'
            referencedColumns: ['id']
          },
        ]
      }
      movements: {
        Row: {
          content_scope: Database['catalog']['Enums']['content_scope']
          created_at: string
          discipline_code: string
          id: string
          name: string
          normalized_name: string
          owner_organization_id: string | null
          owner_person_id: string | null
          status: Database['catalog']['Enums']['publication_status']
          successor_movement_id: string | null
        }
        Insert: {
          content_scope: Database['catalog']['Enums']['content_scope']
          created_at?: string
          discipline_code: string
          id?: string
          name: string
          normalized_name: string
          owner_organization_id?: string | null
          owner_person_id?: string | null
          status?: Database['catalog']['Enums']['publication_status']
          successor_movement_id?: string | null
        }
        Update: {
          content_scope?: Database['catalog']['Enums']['content_scope']
          created_at?: string
          discipline_code?: string
          id?: string
          name?: string
          normalized_name?: string
          owner_organization_id?: string | null
          owner_person_id?: string | null
          status?: Database['catalog']['Enums']['publication_status']
          successor_movement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_movements_discipline'
            columns: ['discipline_code']
            isOneToOne: false
            referencedRelation: 'disciplines'
            referencedColumns: ['code']
          },
          {
            foreignKeyName: 'fk_movements_successor'
            columns: ['successor_movement_id']
            isOneToOne: false
            referencedRelation: 'movements'
            referencedColumns: ['id']
          },
        ]
      }
      muscles: {
        Row: {
          body_slug: string | null
          code: string
          created_at: string
          display_order: number
          id: string
          name: string
          region: string
          status: Database['catalog']['Enums']['publication_status']
        }
        Insert: {
          body_slug?: string | null
          code: string
          created_at?: string
          display_order?: number
          id?: string
          name: string
          region: string
          status?: Database['catalog']['Enums']['publication_status']
        }
        Update: {
          body_slug?: string | null
          code?: string
          created_at?: string
          display_order?: number
          id?: string
          name?: string
          region?: string
          status?: Database['catalog']['Enums']['publication_status']
        }
        Relationships: []
      }
      professional_credential_types: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_order: number
          name: string
          status: Database['catalog']['Enums']['publication_status']
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_order: number
          name: string
          status?: Database['catalog']['Enums']['publication_status']
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_order?: number
          name?: string
          status?: Database['catalog']['Enums']['publication_status']
          updated_at?: string
        }
        Relationships: []
      }
      professional_specialties: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_order: number
          name: string
          status: Database['catalog']['Enums']['publication_status']
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_order: number
          name: string
          status?: Database['catalog']['Enums']['publication_status']
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_order?: number
          name?: string
          status?: Database['catalog']['Enums']['publication_status']
          updated_at?: string
        }
        Relationships: []
      }
      result_contracts: {
        Row: {
          activity_family: Database['catalog']['Enums']['activity_family']
          contract_code: string
          contract_schema_version: number
          envelope: Json
          id: string
          minimums: Json
          published_at: string | null
          status: Database['catalog']['Enums']['publication_status']
          version_number: number
        }
        Insert: {
          activity_family: Database['catalog']['Enums']['activity_family']
          contract_code: string
          contract_schema_version?: number
          envelope: Json
          id?: string
          minimums: Json
          published_at?: string | null
          status?: Database['catalog']['Enums']['publication_status']
          version_number: number
        }
        Update: {
          activity_family?: Database['catalog']['Enums']['activity_family']
          contract_code?: string
          contract_schema_version?: number
          envelope?: Json
          id?: string
          minimums?: Json
          published_at?: string | null
          status?: Database['catalog']['Enums']['publication_status']
          version_number?: number
        }
        Relationships: []
      }
      units: {
        Row: {
          code: string
          dimension: string
          id: string
          is_canonical: boolean
          to_canonical_factor: number
        }
        Insert: {
          code: string
          dimension: string
          id?: string
          is_canonical?: boolean
          to_canonical_factor: number
        }
        Update: {
          code?: string
          dimension?: string
          id?: string
          is_canonical?: boolean
          to_canonical_factor?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activity_type_target_family: {
        Args: { p_activity_type_id: string }
        Returns: Database['catalog']['Enums']['activity_family']
      }
      archive_activity_type: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_code: string
          p_command_id: string
          p_idempotency_key: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      archive_discipline: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_code: string
          p_command_id: string
          p_idempotency_key: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      archive_global_movement: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_idempotency_key: string
          p_movement_id: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      deprecate_result_contract: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_contract_id: string
          p_idempotency_key: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      global_catalog_entry_projection: {
        Args: { p_id: string; p_kind: string }
        Returns: Json
      }
      list_activity_type_result_contracts: {
        Args: { p_activity_type_id: string }
        Returns: {
          activity_family: Database['catalog']['Enums']['activity_family']
          contract_code: string
          contract_schema_version: number
          envelope: Json
          is_default: boolean
          minimums: Json
          result_contract_id: string
          valid_from: string
          version_number: number
        }[]
      }
      list_activity_types: {
        Args: never
        Returns: {
          code: string
          discipline_code: string
          id: string
          name: string
        }[]
      }
      list_disciplines: {
        Args: never
        Returns: {
          code: string
          name: string
        }[]
      }
      list_global_catalog: {
        Args: { p_actor_person_id: string; p_actor_session_id: string }
        Returns: Json
      }
      list_professional_credential_types: {
        Args: never
        Returns: {
          code: string
          description: string
          name: string
        }[]
      }
      list_professional_specialties: {
        Args: never
        Returns: {
          code: string
          description: string
          name: string
        }[]
      }
      movement_cursor: {
        Args: { p_id: string; p_name: string }
        Returns: string
      }
      movement_cursor_parts: {
        Args: { p_cursor: string }
        Returns: {
          sort_id: string
          sort_name: string
        }[]
      }
      normalize_movement_name: { Args: { p_name: string }; Returns: string }
      publish_activity_type: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_code: string
          p_command_id: string
          p_discipline_code: string
          p_idempotency_key: string
          p_name: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      publish_discipline: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_code: string
          p_command_id: string
          p_idempotency_key: string
          p_name: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      publish_global_movement: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_discipline_code: string
          p_idempotency_key: string
          p_name: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      publish_result_contract: {
        Args: {
          p_activity_family: Database['catalog']['Enums']['activity_family']
          p_activity_type_id: string
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_contract_code: string
          p_envelope: Json
          p_fixtures: Json
          p_idempotency_key: string
          p_is_default: boolean
          p_minimums: Json
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      published_discipline: { Args: { p_code: string }; Returns: string }
      read_equipment: { Args: { p_person_id: string }; Returns: Json }
      read_movement: {
        Args: { p_movement_id: string; p_person_id: string }
        Returns: Json
      }
      read_movements: {
        Args: {
          p_cursor?: string
          p_discipline_code: string
          p_equipment?: string[]
          p_limit: number
          p_muscles?: string[]
          p_person_id: string
          p_query: string
        }
        Returns: Json
      }
      read_muscles: { Args: { p_person_id: string }; Returns: Json }
      require_catalog_reader: { Args: never; Returns: string }
      require_global_catalog_curator: {
        Args: { p_actor_person_id: string; p_actor_session_id: string }
        Returns: undefined
      }
      result_contract_projection: {
        Args: { p_contract_id: string }
        Returns: Json
      }
    }
    Enums: {
      activity_family: 'strength' | 'endurance' | 'interval' | 'mobility'
      completeness_level: 'partial' | 'summary' | 'detailed' | 'sensor_enriched'
      content_scope: 'global' | 'organization' | 'person'
      publication_status: 'draft' | 'published' | 'deprecated' | 'archived'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  identity: {
    Tables: {
      access_account_mfa_factors: {
        Row: {
          access_account_id: string
          created_at: string
          factor_kind: string
          id: string
          provider: string
          provider_factor_id: string
          revoked_at: string | null
          status: Database['identity']['Enums']['mfa_factor_status']
          superseded_at: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          access_account_id: string
          created_at?: string
          factor_kind?: string
          id?: string
          provider?: string
          provider_factor_id: string
          revoked_at?: string | null
          status?: Database['identity']['Enums']['mfa_factor_status']
          superseded_at?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          access_account_id?: string
          created_at?: string
          factor_kind?: string
          id?: string
          provider?: string
          provider_factor_id?: string
          revoked_at?: string | null
          status?: Database['identity']['Enums']['mfa_factor_status']
          superseded_at?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_access_account_mfa_factors_access_account'
            columns: ['access_account_id']
            isOneToOne: false
            referencedRelation: 'access_accounts'
            referencedColumns: ['id']
          },
        ]
      }
      access_accounts: {
        Row: {
          created_at: string
          id: string
          issuer: string
          linked_at: string
          person_id: string | null
          provider: string
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          issuer: string
          linked_at?: string
          person_id?: string | null
          provider: string
          subject: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          issuer?: string
          linked_at?: string
          person_id?: string | null
          provider?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_access_accounts_person'
            columns: ['person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
        ]
      }
      access_sessions: {
        Row: {
          absolute_expires_at: string | null
          access_account_id: string
          access_token_expires_at: string
          assurance_level: number
          assurance_verified_at: string | null
          authentication_method: string | null
          created_at: string
          id: string
          last_activity_at: string | null
          provider_session_id: string
          revoked_at: string | null
          surface: Database['identity']['Enums']['access_session_surface']
          token_ciphertext: string
          token_hash: string
          token_version: number
          updated_at: string
        }
        Insert: {
          absolute_expires_at?: string | null
          access_account_id: string
          access_token_expires_at: string
          assurance_level?: number
          assurance_verified_at?: string | null
          authentication_method?: string | null
          created_at?: string
          id?: string
          last_activity_at?: string | null
          provider_session_id: string
          revoked_at?: string | null
          surface: Database['identity']['Enums']['access_session_surface']
          token_ciphertext: string
          token_hash: string
          token_version?: number
          updated_at?: string
        }
        Update: {
          absolute_expires_at?: string | null
          access_account_id?: string
          access_token_expires_at?: string
          assurance_level?: number
          assurance_verified_at?: string | null
          authentication_method?: string | null
          created_at?: string
          id?: string
          last_activity_at?: string | null
          provider_session_id?: string
          revoked_at?: string | null
          surface?: Database['identity']['Enums']['access_session_surface']
          token_ciphertext?: string
          token_hash?: string
          token_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_access_sessions_access_account'
            columns: ['access_account_id']
            isOneToOne: false
            referencedRelation: 'access_accounts'
            referencedColumns: ['id']
          },
        ]
      }
      backoffice_authentication_attempts: {
        Row: {
          access_account_id: string
          access_token_expires_at: string
          attempt_token_hash: string
          completed_session_id: string | null
          created_at: string
          expires_at: string
          factor_id: string
          id: string
          invalid_code_count: number
          provider_challenge_id: string
          provider_session_id: string
          secret_ciphertext: string | null
          status: Database['identity']['Enums']['backoffice_authentication_attempt_status']
          terminal_at: string | null
          updated_at: string
          verification_command_id: string | null
          verification_idempotency_key: string | null
        }
        Insert: {
          access_account_id: string
          access_token_expires_at: string
          attempt_token_hash: string
          completed_session_id?: string | null
          created_at?: string
          expires_at: string
          factor_id: string
          id?: string
          invalid_code_count?: number
          provider_challenge_id: string
          provider_session_id: string
          secret_ciphertext?: string | null
          status: Database['identity']['Enums']['backoffice_authentication_attempt_status']
          terminal_at?: string | null
          updated_at?: string
          verification_command_id?: string | null
          verification_idempotency_key?: string | null
        }
        Update: {
          access_account_id?: string
          access_token_expires_at?: string
          attempt_token_hash?: string
          completed_session_id?: string | null
          created_at?: string
          expires_at?: string
          factor_id?: string
          id?: string
          invalid_code_count?: number
          provider_challenge_id?: string
          provider_session_id?: string
          secret_ciphertext?: string | null
          status?: Database['identity']['Enums']['backoffice_authentication_attempt_status']
          terminal_at?: string | null
          updated_at?: string
          verification_command_id?: string | null
          verification_idempotency_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_backoffice_authentication_attempts_access_account'
            columns: ['access_account_id']
            isOneToOne: false
            referencedRelation: 'access_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_backoffice_authentication_attempts_factor'
            columns: ['factor_id']
            isOneToOne: false
            referencedRelation: 'access_account_mfa_factors'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_backoffice_authentication_attempts_session'
            columns: ['completed_session_id']
            isOneToOne: false
            referencedRelation: 'access_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      body_progress_metrics: {
        Row: {
          code: string
          created_at: string
          dimension: string
          maximum_value: number
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          dimension: string
          maximum_value: number
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          dimension?: string
          maximum_value?: number
          name?: string
        }
        Relationships: []
      }
      body_progress_records: {
        Row: {
          created_at: string
          has_media: boolean
          id: string
          measured_on: string
          media_ref: string | null
          metric_code: string
          original_unit_code: string | null
          original_value: number | null
          person_id: string
          unit_code: string
          value_numeric: number
        }
        Insert: {
          created_at?: string
          has_media?: boolean
          id: string
          measured_on?: string
          media_ref?: string | null
          metric_code: string
          original_unit_code?: string | null
          original_value?: number | null
          person_id: string
          unit_code: string
          value_numeric: number
        }
        Update: {
          created_at?: string
          has_media?: boolean
          id?: string
          measured_on?: string
          media_ref?: string | null
          metric_code?: string
          original_unit_code?: string | null
          original_value?: number | null
          person_id?: string
          unit_code?: string
          value_numeric?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_body_progress_records_metric'
            columns: ['metric_code']
            isOneToOne: false
            referencedRelation: 'body_progress_metrics'
            referencedColumns: ['code']
          },
          {
            foreignKeyName: 'fk_body_progress_records_person'
            columns: ['person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
        ]
      }
      credential_verification_requests: {
        Row: {
          cancelled_at: string | null
          created_at: string
          id: string
          kind: string
          professional_credential_id: string
          requested_by_person_id: string
          resolved_at: string | null
          status: string
          supersedes_request_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          professional_credential_id: string
          requested_by_person_id: string
          resolved_at?: string | null
          status?: string
          supersedes_request_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          professional_credential_id?: string
          requested_by_person_id?: string
          resolved_at?: string | null
          status?: string
          supersedes_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_credential_verification_requests_credential'
            columns: ['professional_credential_id']
            isOneToOne: false
            referencedRelation: 'professional_credentials'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_credential_verification_requests_requester'
            columns: ['requested_by_person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_credential_verification_requests_supersedes'
            columns: ['supersedes_request_id']
            isOneToOne: false
            referencedRelation: 'credential_verification_requests'
            referencedColumns: ['id']
          },
        ]
      }
      eligibility_evidence: {
        Row: {
          evaluated_at: string
          id: string
          onboarding_attempt_id: string
          policy_snapshot: Json
          policy_snapshot_schema_version: number
          policy_version: number
          result: Database['identity']['Enums']['eligibility_result']
        }
        Insert: {
          evaluated_at?: string
          id?: string
          onboarding_attempt_id: string
          policy_snapshot: Json
          policy_snapshot_schema_version?: number
          policy_version: number
          result: Database['identity']['Enums']['eligibility_result']
        }
        Update: {
          evaluated_at?: string
          id?: string
          onboarding_attempt_id?: string
          policy_snapshot?: Json
          policy_snapshot_schema_version?: number
          policy_version?: number
          result?: Database['identity']['Enums']['eligibility_result']
        }
        Relationships: [
          {
            foreignKeyName: 'fk_eligibility_evidence_attempt'
            columns: ['onboarding_attempt_id']
            isOneToOne: false
            referencedRelation: 'onboarding_attempts'
            referencedColumns: ['id']
          },
        ]
      }
      fitness_profile_claims: {
        Row: {
          attribute_code: string
          captured_by_assignment_id: string | null
          captured_by_kind: Database['identity']['Enums']['actor_kind']
          id: string
          person_id: string
          provenance: Database['identity']['Enums']['provenance']
          superseded_by_id: string | null
          unit_code: string | null
          valid_from: string
          valid_to: string | null
          value_numeric: number | null
          value_text: string | null
        }
        Insert: {
          attribute_code: string
          captured_by_assignment_id?: string | null
          captured_by_kind: Database['identity']['Enums']['actor_kind']
          id: string
          person_id: string
          provenance: Database['identity']['Enums']['provenance']
          superseded_by_id?: string | null
          unit_code?: string | null
          valid_from?: string
          valid_to?: string | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Update: {
          attribute_code?: string
          captured_by_assignment_id?: string | null
          captured_by_kind?: Database['identity']['Enums']['actor_kind']
          id?: string
          person_id?: string
          provenance?: Database['identity']['Enums']['provenance']
          superseded_by_id?: string | null
          unit_code?: string | null
          valid_from?: string
          valid_to?: string | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_fitness_profile_claims_attribute'
            columns: ['attribute_code']
            isOneToOne: false
            referencedRelation: 'profile_attributes'
            referencedColumns: ['code']
          },
          {
            foreignKeyName: 'fk_fitness_profile_claims_person'
            columns: ['person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_fitness_profile_claims_superseded'
            columns: ['superseded_by_id']
            isOneToOne: false
            referencedRelation: 'fitness_profile_claims'
            referencedColumns: ['id']
          },
        ]
      }
      health_context_claims: {
        Row: {
          body_area: string | null
          context_type: string
          created_at: string
          description: string
          id: string
          person_id: string
          provenance: Database['identity']['Enums']['provenance']
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          body_area?: string | null
          context_type: string
          created_at?: string
          description: string
          id: string
          person_id: string
          provenance: Database['identity']['Enums']['provenance']
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          body_area?: string | null
          context_type?: string
          created_at?: string
          description?: string
          id?: string
          person_id?: string
          provenance?: Database['identity']['Enums']['provenance']
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_health_context_claims_person'
            columns: ['person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
        ]
      }
      identity_action_events: {
        Row: {
          actor_duty_assignment_id: string | null
          actor_kind: string
          actor_person_id: string | null
          case_reference: string | null
          delivery_channel: string | null
          event_type: string
          id: string
          occurred_at: string
          request_id: string
          result_code: string | null
        }
        Insert: {
          actor_duty_assignment_id?: string | null
          actor_kind: string
          actor_person_id?: string | null
          case_reference?: string | null
          delivery_channel?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          request_id: string
          result_code?: string | null
        }
        Update: {
          actor_duty_assignment_id?: string | null
          actor_kind?: string
          actor_person_id?: string | null
          case_reference?: string | null
          delivery_channel?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          request_id?: string
          result_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_identity_action_events_actor'
            columns: ['actor_person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_identity_action_events_request'
            columns: ['request_id']
            isOneToOne: false
            referencedRelation: 'identity_action_requests'
            referencedColumns: ['id']
          },
        ]
      }
      identity_action_requests: {
        Row: {
          access_account_id: string
          action_kind: Database['identity']['Enums']['identity_action_kind']
          cancelled_at: string | null
          case_reference: string | null
          confirmed_at: string | null
          contact_fingerprint: string
          contact_hint: string
          created_at: string
          delivered_at: string | null
          delivery_channel: string
          expires_at: string
          failed_at: string | null
          failure_code: string | null
          id: string
          initiated_by_duty_assignment_id: string | null
          initiated_by_kind: string
          initiated_by_person_id: string
          person_id: string
          status: Database['identity']['Enums']['identity_action_status']
          updated_at: string
        }
        Insert: {
          access_account_id: string
          action_kind: Database['identity']['Enums']['identity_action_kind']
          cancelled_at?: string | null
          case_reference?: string | null
          confirmed_at?: string | null
          contact_fingerprint: string
          contact_hint: string
          created_at?: string
          delivered_at?: string | null
          delivery_channel: string
          expires_at: string
          failed_at?: string | null
          failure_code?: string | null
          id: string
          initiated_by_duty_assignment_id?: string | null
          initiated_by_kind: string
          initiated_by_person_id: string
          person_id: string
          status?: Database['identity']['Enums']['identity_action_status']
          updated_at?: string
        }
        Update: {
          access_account_id?: string
          action_kind?: Database['identity']['Enums']['identity_action_kind']
          cancelled_at?: string | null
          case_reference?: string | null
          confirmed_at?: string | null
          contact_fingerprint?: string
          contact_hint?: string
          created_at?: string
          delivered_at?: string | null
          delivery_channel?: string
          expires_at?: string
          failed_at?: string | null
          failure_code?: string | null
          id?: string
          initiated_by_duty_assignment_id?: string | null
          initiated_by_kind?: string
          initiated_by_person_id?: string
          person_id?: string
          status?: Database['identity']['Enums']['identity_action_status']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_identity_action_requests_account'
            columns: ['access_account_id']
            isOneToOne: false
            referencedRelation: 'access_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_identity_action_requests_initiator'
            columns: ['initiated_by_person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_identity_action_requests_person'
            columns: ['person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
        ]
      }
      invitation_intents: {
        Row: {
          created_at: string
          decided_at: string | null
          id: string
          invitation_id: string
          kind: Database['identity']['Enums']['invitation_intent_kind']
          materialized_membership_id: string | null
          materialized_relationship_id: string | null
          proposed_role_code: string | null
          status: Database['identity']['Enums']['invitation_intent_status']
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          id?: string
          invitation_id: string
          kind: Database['identity']['Enums']['invitation_intent_kind']
          materialized_membership_id?: string | null
          materialized_relationship_id?: string | null
          proposed_role_code?: string | null
          status?: Database['identity']['Enums']['invitation_intent_status']
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          id?: string
          invitation_id?: string
          kind?: Database['identity']['Enums']['invitation_intent_kind']
          materialized_membership_id?: string | null
          materialized_relationship_id?: string | null
          proposed_role_code?: string | null
          status?: Database['identity']['Enums']['invitation_intent_status']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_invitation_intents_invitation'
            columns: ['invitation_id']
            isOneToOne: false
            referencedRelation: 'invitations'
            referencedColumns: ['id']
          },
        ]
      }
      invitation_resends: {
        Row: {
          actor_duty_assignment_id: string
          actor_person_id: string
          created_at: string
          delivered_invitation_id: string
          id: string
          invitation_id: string
          kind: Database['identity']['Enums']['invitation_intent_kind']
          outcome: string
        }
        Insert: {
          actor_duty_assignment_id: string
          actor_person_id: string
          created_at?: string
          delivered_invitation_id: string
          id?: string
          invitation_id: string
          kind: Database['identity']['Enums']['invitation_intent_kind']
          outcome: string
        }
        Update: {
          actor_duty_assignment_id?: string
          actor_person_id?: string
          created_at?: string
          delivered_invitation_id?: string
          id?: string
          invitation_id?: string
          kind?: Database['identity']['Enums']['invitation_intent_kind']
          outcome?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_invitation_resends_actor'
            columns: ['actor_person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_invitation_resends_delivered'
            columns: ['delivered_invitation_id']
            isOneToOne: false
            referencedRelation: 'invitations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_invitation_resends_invitation'
            columns: ['invitation_id']
            isOneToOne: false
            referencedRelation: 'invitations'
            referencedColumns: ['id']
          },
        ]
      }
      invitations: {
        Row: {
          channel: string
          contact: string
          created_at: string
          expires_at: string
          id: string
          issued_by_duty_assignment_id: string | null
          issued_by_membership_id: string | null
          issued_by_person_id: string | null
          organization_id: string
          proposal_hash: string
          reissues_invitation_id: string | null
          responsible_party: Json
          responsible_party_schema_version: number
          status: Database['identity']['Enums']['invitation_status']
          token_hash: string
          token_key_version: number
          updated_at: string
        }
        Insert: {
          channel: string
          contact: string
          created_at?: string
          expires_at: string
          id: string
          issued_by_duty_assignment_id?: string | null
          issued_by_membership_id?: string | null
          issued_by_person_id?: string | null
          organization_id: string
          proposal_hash: string
          reissues_invitation_id?: string | null
          responsible_party: Json
          responsible_party_schema_version?: number
          status?: Database['identity']['Enums']['invitation_status']
          token_hash: string
          token_key_version: number
          updated_at?: string
        }
        Update: {
          channel?: string
          contact?: string
          created_at?: string
          expires_at?: string
          id?: string
          issued_by_duty_assignment_id?: string | null
          issued_by_membership_id?: string | null
          issued_by_person_id?: string | null
          organization_id?: string
          proposal_hash?: string
          reissues_invitation_id?: string | null
          responsible_party?: Json
          responsible_party_schema_version?: number
          status?: Database['identity']['Enums']['invitation_status']
          token_hash?: string
          token_key_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_invitations_platform_issuer'
            columns: ['issued_by_person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_invitations_reissues'
            columns: ['reissues_invitation_id']
            isOneToOne: false
            referencedRelation: 'invitations'
            referencedColumns: ['id']
          },
        ]
      }
      mfa_factor_recovery_events: {
        Row: {
          approved_by_person_id: string
          ceremony_reference: string
          factor_id: string
          id: string
          occurred_at: string
          reason_code: string
          requested_by_person_id: string
          subject_person_id: string
        }
        Insert: {
          approved_by_person_id: string
          ceremony_reference: string
          factor_id: string
          id?: string
          occurred_at?: string
          reason_code: string
          requested_by_person_id: string
          subject_person_id: string
        }
        Update: {
          approved_by_person_id?: string
          ceremony_reference?: string
          factor_id?: string
          id?: string
          occurred_at?: string
          reason_code?: string
          requested_by_person_id?: string
          subject_person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_mfa_factor_recovery_events_approver'
            columns: ['approved_by_person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_mfa_factor_recovery_events_factor'
            columns: ['factor_id']
            isOneToOne: false
            referencedRelation: 'access_account_mfa_factors'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_mfa_factor_recovery_events_requester'
            columns: ['requested_by_person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_mfa_factor_recovery_events_subject'
            columns: ['subject_person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
        ]
      }
      onboarding_attempts: {
        Row: {
          account_id: string
          biological_sex_answered_at: string | null
          created_at: string
          expires_at: string
          id: string
          invitation_token_hash: string | null
          person_id: string | null
          privacy_notice_accepted_at: string | null
          privacy_notice_version: string | null
          status: Database['identity']['Enums']['onboarding_status']
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          biological_sex_answered_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          invitation_token_hash?: string | null
          person_id?: string | null
          privacy_notice_accepted_at?: string | null
          privacy_notice_version?: string | null
          status?: Database['identity']['Enums']['onboarding_status']
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          biological_sex_answered_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invitation_token_hash?: string | null
          person_id?: string | null
          privacy_notice_accepted_at?: string | null
          privacy_notice_version?: string | null
          status?: Database['identity']['Enums']['onboarding_status']
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_onboarding_attempts_account'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'access_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_onboarding_attempts_person'
            columns: ['person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
        ]
      }
      onboarding_step_skips: {
        Row: {
          onboarding_attempt_id: string
          skipped_at: string
          step_code: string
        }
        Insert: {
          onboarding_attempt_id: string
          skipped_at?: string
          step_code: string
        }
        Update: {
          onboarding_attempt_id?: string
          skipped_at?: string
          step_code?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_onboarding_step_skips_attempt'
            columns: ['onboarding_attempt_id']
            isOneToOne: false
            referencedRelation: 'onboarding_attempts'
            referencedColumns: ['id']
          },
        ]
      }
      password_reset_receipts: {
        Row: {
          access_account_id: string | null
          id: string
          issuer: string
          occurred_at: string
          processed_at: string | null
          provider: string
          provider_event_id: string
          received_at: string
          result: Database['identity']['Enums']['password_reset_receipt_result'] | null
          revoked_session_count: number
        }
        Insert: {
          access_account_id?: string | null
          id?: string
          issuer: string
          occurred_at: string
          processed_at?: string | null
          provider: string
          provider_event_id: string
          received_at?: string
          result?: Database['identity']['Enums']['password_reset_receipt_result'] | null
          revoked_session_count?: number
        }
        Update: {
          access_account_id?: string | null
          id?: string
          issuer?: string
          occurred_at?: string
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          received_at?: string
          result?: Database['identity']['Enums']['password_reset_receipt_result'] | null
          revoked_session_count?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_password_reset_receipts_access_account'
            columns: ['access_account_id']
            isOneToOne: false
            referencedRelation: 'access_accounts'
            referencedColumns: ['id']
          },
        ]
      }
      people: {
        Row: {
          activated_at: string | null
          biological_sex: Database['identity']['Enums']['biological_sex'] | null
          contact_email: string | null
          contact_email_verified_at: string | null
          contact_phone: string | null
          contact_phone_verified_at: string | null
          created_at: string
          display_name: string | null
          family_name: string
          given_name: string
          id: string
          status: Database['identity']['Enums']['person_status']
          updated_at: string
          username: string | null
        }
        Insert: {
          activated_at?: string | null
          biological_sex?: Database['identity']['Enums']['biological_sex'] | null
          contact_email?: string | null
          contact_email_verified_at?: string | null
          contact_phone?: string | null
          contact_phone_verified_at?: string | null
          created_at?: string
          display_name?: string | null
          family_name: string
          given_name: string
          id?: string
          status?: Database['identity']['Enums']['person_status']
          updated_at?: string
          username?: string | null
        }
        Update: {
          activated_at?: string | null
          biological_sex?: Database['identity']['Enums']['biological_sex'] | null
          contact_email?: string | null
          contact_email_verified_at?: string | null
          contact_phone?: string | null
          contact_phone_verified_at?: string | null
          created_at?: string
          display_name?: string | null
          family_name?: string
          given_name?: string
          id?: string
          status?: Database['identity']['Enums']['person_status']
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      professional_credential_verifications: {
        Row: {
          decided_at: string
          evidence_fingerprint: string
          id: string
          method: string
          policy_code: string
          professional_credential_id: string
          request_id: string | null
          result: string
          revoked_at: string | null
          source_authority: string
          source_checked_at: string
          source_jurisdiction: string
          source_reference: string
          source_status: string
          source_valid_to: string | null
          supersedes_verification_id: string | null
          valid_from: string | null
          valid_to: string | null
          verifier_person_id: string
        }
        Insert: {
          decided_at?: string
          evidence_fingerprint: string
          id?: string
          method: string
          policy_code: string
          professional_credential_id: string
          request_id?: string | null
          result: string
          revoked_at?: string | null
          source_authority: string
          source_checked_at: string
          source_jurisdiction: string
          source_reference: string
          source_status: string
          source_valid_to?: string | null
          supersedes_verification_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          verifier_person_id: string
        }
        Update: {
          decided_at?: string
          evidence_fingerprint?: string
          id?: string
          method?: string
          policy_code?: string
          professional_credential_id?: string
          request_id?: string | null
          result?: string
          revoked_at?: string | null
          source_authority?: string
          source_checked_at?: string
          source_jurisdiction?: string
          source_reference?: string
          source_status?: string
          source_valid_to?: string | null
          supersedes_verification_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          verifier_person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_professional_credential_verifications_credential'
            columns: ['professional_credential_id']
            isOneToOne: false
            referencedRelation: 'professional_credentials'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_professional_credential_verifications_request'
            columns: ['request_id', 'professional_credential_id']
            isOneToOne: false
            referencedRelation: 'credential_verification_requests'
            referencedColumns: ['id', 'professional_credential_id']
          },
          {
            foreignKeyName: 'fk_professional_credential_verifications_supersedes'
            columns: ['supersedes_verification_id']
            isOneToOne: false
            referencedRelation: 'professional_credential_verifications'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_professional_credential_verifications_verifier'
            columns: ['verifier_person_id']
            isOneToOne: false
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
        ]
      }
      professional_credentials: {
        Row: {
          created_at: string
          credential_type_code: string
          expires_on: string | null
          id: string
          identifier: string | null
          issued_on: string | null
          issuer: string
          name: string
          professional_profile_id: string
          retired_at: string | null
          status: string
          supersedes_credential_id: string | null
          verification_url: string | null
        }
        Insert: {
          created_at?: string
          credential_type_code: string
          expires_on?: string | null
          id?: string
          identifier?: string | null
          issued_on?: string | null
          issuer: string
          name: string
          professional_profile_id: string
          retired_at?: string | null
          status?: string
          supersedes_credential_id?: string | null
          verification_url?: string | null
        }
        Update: {
          created_at?: string
          credential_type_code?: string
          expires_on?: string | null
          id?: string
          identifier?: string | null
          issued_on?: string | null
          issuer?: string
          name?: string
          professional_profile_id?: string
          retired_at?: string | null
          status?: string
          supersedes_credential_id?: string | null
          verification_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_professional_credentials_profile'
            columns: ['professional_profile_id']
            isOneToOne: false
            referencedRelation: 'professional_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_professional_credentials_supersedes'
            columns: ['supersedes_credential_id']
            isOneToOne: false
            referencedRelation: 'professional_credentials'
            referencedColumns: ['id']
          },
        ]
      }
      professional_profile_specialties: {
        Row: {
          declared_at: string
          professional_profile_id: string
          specialty_code: string
        }
        Insert: {
          declared_at?: string
          professional_profile_id: string
          specialty_code: string
        }
        Update: {
          declared_at?: string
          professional_profile_id?: string
          specialty_code?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_professional_profile_specialties_profile'
            columns: ['professional_profile_id']
            isOneToOne: false
            referencedRelation: 'professional_profiles'
            referencedColumns: ['id']
          },
        ]
      }
      professional_profiles: {
        Row: {
          bio: string
          created_at: string
          headline: string
          id: string
          person_id: string
          practice_started_year: number
          updated_at: string
        }
        Insert: {
          bio: string
          created_at?: string
          headline: string
          id?: string
          person_id: string
          practice_started_year: number
          updated_at?: string
        }
        Update: {
          bio?: string
          created_at?: string
          headline?: string
          id?: string
          person_id?: string
          practice_started_year?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_professional_profiles_person'
            columns: ['person_id']
            isOneToOne: true
            referencedRelation: 'people'
            referencedColumns: ['id']
          },
        ]
      }
      profile_attributes: {
        Row: {
          allowed_values: string[] | null
          code: string
          created_at: string
          data_classification_code: string
          id: string
          name: string
          unit_dimension: string | null
          value_kind: string
        }
        Insert: {
          allowed_values?: string[] | null
          code: string
          created_at?: string
          data_classification_code: string
          id?: string
          name: string
          unit_dimension?: string | null
          value_kind: string
        }
        Update: {
          allowed_values?: string[] | null
          code?: string
          created_at?: string
          data_classification_code?: string
          id?: string
          name?: string
          unit_dimension?: string | null
          value_kind?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      account_recovery_contact_fingerprint: {
        Args: { p_email: string }
        Returns: string
      }
      account_recovery_projection: {
        Args: { p_request_id: string }
        Returns: Json
      }
      account_recovery_unavailable_reason: {
        Args: { p_person_id: string }
        Returns: string
      }
      activate_person: {
        Args: {
          p_account_id: string
          p_attempt_id: string
          p_command_id: string
          p_family_name: string
          p_given_name: string
          p_idempotency_key: string
          p_privacy_notice_accepted: boolean
          p_request_hash: string
          p_terms_accepted: boolean
        }
        Returns: string
      }
      associate_onboarding_invitation: {
        Args: {
          p_account_id: string
          p_attempt_id: string
          p_token_hash: string
        }
        Returns: undefined
      }
      backoffice_client_invitation_projection: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      backoffice_team_invitation_projection: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      bind_backoffice_totp_verification: {
        Args: {
          p_attempt_token_hash: string
          p_command_id: string
          p_idempotency_key: string
        }
        Returns: undefined
      }
      body_progress_projection: { Args: { p_record_id: string }; Returns: Json }
      cancel_account_recovery: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_case_reference: string
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
          p_request_id: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      client_invitation_projection: {
        Args: { p_invitation_id: string }
        Returns: {
          channel: string
          contact_hint: string
          expires_at: string
          invitation_id: string
          invitation_intent_id: string
          scope_codes: string[]
          status: string
        }[]
      }
      complete_backoffice_authentication: {
        Args: {
          p_access_token_expires_at: string
          p_attempt_token_hash: string
          p_command_id: string
          p_idempotency_key: string
          p_session_token_ciphertext: string
          p_session_token_hash: string
        }
        Returns: {
          replayed: boolean
          session_id: string
        }[]
      }
      consume_account_recovery_send: {
        Args: { p_person_id: string }
        Returns: undefined
      }
      consume_staff_invitation_rate_limit: {
        Args: {
          p_contact: string
          p_organization_id: string
          p_person_id: string
        }
        Returns: undefined
      }
      create_access_session: {
        Args: {
          p_access_account_id: string
          p_access_token_expires_at: string
          p_provider_session_id: string
          p_surface: Database['identity']['Enums']['access_session_surface']
          p_token_ciphertext: string
          p_token_hash: string
        }
        Returns: string
      }
      credential_verification_conflict: {
        Args: { p_credential_id: string; p_verifier_person_id: string }
        Returns: string
      }
      credential_verification_decision_projection: {
        Args: { p_request_id: string }
        Returns: Json
      }
      credential_verification_method_for: {
        Args: { p_credential_type_code: string }
        Returns: string
      }
      current_focus_areas: { Args: { p_person_id: string }; Returns: string[] }
      decide_client_invitation: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_intent_id: string
          p_person_id: string
          p_relationship_decision: string
          p_request_hash: string
          p_scope_decisions: Json
          p_token_hash: string
        }
        Returns: {
          granted_scope_codes: string[]
          intent_status: string
          invitation_id: string
          invitation_intent_id: string
          invitation_status: string
          organization_id: string
          relationship_id: string
          replayed: boolean
        }[]
      }
      decide_credential_verification: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_idempotency_key: string
          p_method: string
          p_request_hash: string
          p_request_id: string
          p_result: string
          p_source_authority: string
          p_source_checked_at: string
          p_source_jurisdiction: string
          p_source_reference: string
          p_source_status: string
          p_source_valid_to: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      decide_ownership_invitation: {
        Args: {
          p_command_id: string
          p_decision: string
          p_idempotency_key: string
          p_intent_id: string
          p_person_id: string
          p_request_hash: string
          p_token_hash: string
        }
        Returns: {
          intent_status: string
          invitation_id: string
          invitation_intent_id: string
          invitation_status: string
          membership_id: string
          organization_id: string
          replayed: boolean
        }[]
      }
      decide_staff_invitation: {
        Args: {
          p_command_id: string
          p_decision: string
          p_idempotency_key: string
          p_intent_id: string
          p_person_id: string
          p_request_hash: string
          p_token_hash: string
        }
        Returns: {
          intent_status: string
          invitation_id: string
          invitation_intent_id: string
          invitation_status: string
          membership_id: string
          organization_id: string
          proposed_role_code: string
          replayed: boolean
        }[]
      }
      declare_biological_sex: {
        Args: {
          p_account_id: string
          p_attempt_id: string
          p_command_id: string
          p_idempotency_key: string
          p_request_hash: string
          p_value: string
        }
        Returns: {
          biological_sex: string
          replayed: boolean
        }[]
      }
      declare_fitness_id: {
        Args: {
          p_account_id: string
          p_attempt_id: string
          p_command_id: string
          p_contact_email: string
          p_contact_email_verified: boolean
          p_family_name: string
          p_given_name: string
          p_idempotency_key: string
          p_request_hash: string
          p_username: string
        }
        Returns: {
          contact_email: string
          contact_email_verified: boolean
          family_name: string
          given_name: string
          person_id: string
          username: string
        }[]
      }
      declare_focus_areas: {
        Args: {
          p_account_id: string
          p_areas: string[]
          p_command_id: string
          p_idempotency_key: string
          p_request_hash: string
        }
        Returns: {
          areas: string[]
          replayed: boolean
        }[]
      }
      declare_professional_credential: {
        Args: {
          p_command_id: string
          p_credential_type_code: string
          p_expires_on: string
          p_idempotency_key: string
          p_identifier: string
          p_issued_on: string
          p_issuer: string
          p_name: string
          p_person_id: string
          p_request_hash: string
          p_verification_url: string
        }
        Returns: {
          credential: Json
          replayed: boolean
        }[]
      }
      declare_profile_claim: {
        Args: {
          p_account_id: string
          p_attribute_code: string
          p_command_id: string
          p_idempotency_key: string
          p_request_hash: string
          p_unit_code: string
          p_value_numeric: number
          p_value_text: string
        }
        Returns: {
          attribute_code: string
          claim_id: string
          replayed: boolean
          superseded_claim_id: string
          value_numeric: number
          value_text: string
        }[]
      }
      delete_body_progress: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_issuer: string
          p_provider: string
          p_record_id: string
          p_request_hash: string
          p_subject: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      delete_health_context: {
        Args: {
          p_claim_id: string
          p_command_id: string
          p_idempotency_key: string
          p_issuer: string
          p_provider: string
          p_request_hash: string
          p_subject: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      expire_backoffice_authentication_attempts: {
        Args: { p_limit: number }
        Returns: number
      }
      expire_staff_invitations: { Args: { p_limit?: number }; Returns: number }
      fail_account_recovery_delivery: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      get_my_professional_context: {
        Args: { p_person_id: string; p_request_id: string }
        Returns: Json
      }
      health_context_projection: { Args: { p_claim_id: string }; Returns: Json }
      issue_client_invitation: {
        Args: {
          p_channel: string
          p_command_id: string
          p_contact: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
          p_scope_options: Json
          p_token_hash: string
          p_token_key_version: number
        }
        Returns: {
          channel: string
          contact_hint: string
          expires_at: string
          invitation_id: string
          invitation_intent_id: string
          replayed: boolean
          reused: boolean
          scope_codes: string[]
          status: string
        }[]
      }
      issue_staff_invitation: {
        Args: {
          p_channel: string
          p_command_id: string
          p_contact: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_proposed_role_code: string
          p_request_hash: string
          p_token_hash: string
          p_token_key_version: number
        }
        Returns: {
          channel: string
          contact_hint: string
          expires_at: string
          invitation_id: string
          invitation_intent_id: string
          proposed_role_code: string
          replayed: boolean
          reused: boolean
          status: string
        }[]
      }
      list_backoffice_client_invitations: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      list_backoffice_team_invitations: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      list_body_progress: {
        Args: {
          p_before_id?: string
          p_before_measured_on?: string
          p_issuer: string
          p_limit: number
          p_provider: string
          p_subject: string
        }
        Returns: Json
      }
      list_credential_verification_requests: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_limit: number
        }
        Returns: {
          credential_id: string
          credential_identifier: string
          credential_name: string
          credential_type_code: string
          credential_type_name: string
          expires_on: string
          holder_family_name: string
          holder_given_name: string
          holder_person_id: string
          issued_on: string
          issuer: string
          kind: string
          previous_result: string
          previous_valid_to: string
          request_id: string
          requested_at: string
          suggested_method: string
          verification_url: string
          viewer_can_decide: boolean
        }[]
      }
      list_due_credential_renewals: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_limit: number
        }
        Returns: {
          credential_id: string
          credential_name: string
          credential_type_code: string
          credential_type_name: string
          holder_family_name: string
          holder_given_name: string
          holder_person_id: string
          issuer: string
          last_valid_to: string
        }[]
      }
      list_health_context: {
        Args: {
          p_before_id?: string
          p_before_valid_from?: string
          p_issuer: string
          p_limit: number
          p_provider: string
          p_subject: string
        }
        Returns: Json
      }
      list_staff_invitations: {
        Args: {
          p_cursor_created_at: string
          p_cursor_id: string
          p_limit: number
          p_organization_id: string
          p_person_id: string
          p_status: string
        }
        Returns: {
          channel: string
          contact: string
          created_at: string
          decided_at: string
          expires_at: string
          intent_status: string
          invitation_id: string
          invitation_intent_id: string
          proposed_role_code: string
          status: string
        }[]
      }
      load_access_session: {
        Args: {
          p_surface: Database['identity']['Enums']['access_session_surface']
          p_token_hash: string
        }
        Returns: {
          access_token_expires_at: string
          account_id: string
          external_subject: string
          person_id: string
          person_status: string
          provider_session_id: string
          session_id: string
          token_ciphertext: string
          token_version: number
        }[]
      }
      load_backoffice_access_session: {
        Args: { p_token_hash: string }
        Returns: {
          absolute_expires_at: string
          access_token_expires_at: string
          account_id: string
          assurance_level: number
          assurance_verified_at: string
          authentication_method: string
          external_subject: string
          family_name: string
          given_name: string
          last_activity_at: string
          person_id: string
          provider_session_id: string
          session_id: string
          token_ciphertext: string
          token_version: number
        }[]
      }
      load_backoffice_authentication_attempt: {
        Args: { p_attempt_token_hash: string }
        Returns: {
          access_token_expires_at: string
          account_id: string
          attempt_id: string
          attempt_status: Database['identity']['Enums']['backoffice_authentication_attempt_status']
          completed_session_id: string
          expires_at: string
          external_subject: string
          factor_id: string
          factor_status: Database['identity']['Enums']['mfa_factor_status']
          family_name: string
          given_name: string
          invalid_code_count: number
          person_id: string
          provider_challenge_id: string
          provider_factor_id: string
          provider_session_id: string
          secret_ciphertext: string
          verification_command_id: string
          verification_idempotency_key: string
        }[]
      }
      logout_backoffice_access_session: {
        Args: { p_token_hash: string }
        Returns: {
          outcome: string
          provider_session_id: string
        }[]
      }
      open_credential_verification_renewal: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_credential_id: string
          p_idempotency_key: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      prepare_account_recovery_delivery: {
        Args: { p_event_id: string }
        Returns: {
          contact: string
          delivery_state: string
          request_id: string
        }[]
      }
      prepare_backoffice_auth_cleanup: {
        Args: { p_event_id: string }
        Returns: {
          cleanup_state: string
          provider_factor_id: string
          provider_session_id: string
        }[]
      }
      prepare_client_invitation_delivery: {
        Args: { p_event_id: string }
        Returns: {
          contact: string
          delivery_state: string
          expires_at: string
          invitation_id: string
          organization_name: string
          token_key_version: number
        }[]
      }
      prepare_ownership_invitation_delivery: {
        Args: { p_event_id: string }
        Returns: {
          contact: string
          delivery_state: string
          expires_at: string
          invitation_id: string
          organization_name: string
          token_key_version: number
        }[]
      }
      prepare_staff_invitation_delivery: {
        Args: { p_event_id: string }
        Returns: {
          contact: string
          delivery_state: string
          expires_at: string
          invitation_id: string
          organization_name: string
          proposed_role_code: string
          token_key_version: number
        }[]
      }
      process_password_reset_succeeded: {
        Args: {
          p_issuer: string
          p_occurred_at: string
          p_provider: string
          p_provider_event_id: string
          p_subject: string
        }
        Returns: {
          outcome: string
          replayed: boolean
          revoked_session_count: number
        }[]
      }
      professional_credential_projection: {
        Args: { p_credential_id: string }
        Returns: Json
      }
      professional_profile_projection: {
        Args: { p_profile_id: string }
        Returns: Json
      }
      put_professional_profile: {
        Args: {
          p_bio: string
          p_command_id: string
          p_headline: string
          p_idempotency_key: string
          p_person_id: string
          p_practice_started_year: number
          p_request_hash: string
          p_specialty_codes: string[]
        }
        Returns: {
          profile: Json
          replayed: boolean
        }[]
      }
      read_account_recovery: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_case_reference: string
          p_person_id: string
        }
        Returns: Json
      }
      read_current_onboarding: {
        Args: { p_account_id: string }
        Returns: {
          answers: Json
          attempt_id: string
          eligibility_status: string
          expires_at: string
          status: string
        }[]
      }
      read_training_profile: {
        Args: { p_person_id: string }
        Returns: {
          biological_sex: string
          focus_areas: string[]
          given_name: string
          primary_training_goal: string
          training_experience: string
        }[]
      }
      record_account_recovery_access: {
        Args: { p_actor_person_id: string; p_person_id: string }
        Returns: undefined
      }
      record_account_recovery_delivery: {
        Args: { p_event_id: string; p_expires_at: string }
        Returns: undefined
      }
      record_adult_eligibility: {
        Args: {
          p_account_id: string
          p_attempt_id: string
          p_command_id: string
          p_declared_adult: boolean
          p_idempotency_key: string
          p_request_hash: string
        }
        Returns: {
          evaluated_at: string
          result: string
        }[]
      }
      record_backoffice_totp_failure: {
        Args: { p_attempt_token_hash: string }
        Returns: {
          remaining_attempts: number
          terminal: boolean
        }[]
      }
      record_body_progress: {
        Args: {
          p_account_id: string
          p_command_id: string
          p_idempotency_key: string
          p_measured_on: string
          p_metric_code: string
          p_request_hash: string
          p_unit_code: string
          p_value: number
        }
        Returns: {
          metric_code: string
          original_unit_code: string
          original_value: number
          record_id: string
          replayed: boolean
          unit_code: string
          value_numeric: number
        }[]
      }
      record_health_context: {
        Args: {
          p_body_area: string
          p_claim_id: string
          p_context_type: string
          p_description: string
          p_idempotency_key: string
          p_issuer: string
          p_provider: string
          p_request_hash: string
          p_subject: string
          p_valid_from: string
          p_valid_to: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      recover_backoffice_totp_factor: {
        Args: {
          p_approved_by_person_id: string
          p_ceremony_reference: string
          p_requested_by_person_id: string
          p_subject_person_id: string
        }
        Returns: string
      }
      require_account_recovery_assistant: {
        Args: { p_actor_person_id: string; p_actor_session_id: string }
        Returns: string
      }
      require_credential_verifier: {
        Args: { p_actor_person_id: string; p_actor_session_id: string }
        Returns: undefined
      }
      require_invitation_resender: {
        Args: { p_actor_person_id: string; p_actor_session_id: string }
        Returns: string
      }
      require_professional_actor: {
        Args: { p_person_id: string }
        Returns: undefined
      }
      require_space_person: {
        Args: { p_issuer: string; p_provider: string; p_subject: string }
        Returns: string
      }
      resend_account_recovery: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_case_reference: string
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
          p_request_id: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      resend_client_invitation: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_idempotency_key: string
          p_invitation_id: string
          p_organization_id: string
          p_request_hash: string
          p_token_hash: string
          p_token_key_version: number
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      resend_team_invitation: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_idempotency_key: string
          p_invitation_id: string
          p_organization_id: string
          p_request_hash: string
          p_token_hash: string
          p_token_key_version: number
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      resolve_actor_registration: {
        Args: { p_account_id: string }
        Returns: {
          person_id: string
          person_status: string
        }[]
      }
      resolve_backoffice_account: {
        Args: { p_issuer: string; p_provider: string; p_subject: string }
        Returns: {
          account_id: string
          factor_id: string
          family_name: string
          given_name: string
          person_id: string
          provider_factor_id: string
        }[]
      }
      resolve_client_invitation: {
        Args: { p_token_hash: string }
        Returns: {
          expires_at: string
          invitation_id: string
          invitation_intent_id: string
          organization_display_name: string
          organization_id: string
          responsible_party: Json
          scope_options: Json
          status: string
        }[]
      }
      resolve_or_create_access_account: {
        Args: { p_issuer: string; p_provider: string; p_subject: string }
        Returns: {
          account_id: string
          person_id: string
        }[]
      }
      resolve_ownership_invitation: {
        Args: { p_token_hash: string }
        Returns: {
          expires_at: string
          invitation_id: string
          invitation_intent_id: string
          legal_name: string
          organization_display_name: string
          organization_id: string
          organization_type_name: string
          party_kind: string
          site_name: string
        }[]
      }
      resolve_staff_invitation: {
        Args: { p_token_hash: string }
        Returns: {
          expires_at: string
          invitation_id: string
          invitation_intent_id: string
          organization_display_name: string
          organization_id: string
          proposed_role_code: string
          responsible_party: Json
          status: string
        }[]
      }
      retire_professional_credential: {
        Args: {
          p_command_id: string
          p_credential_id: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
        }
        Returns: {
          credential: Json
          replayed: boolean
        }[]
      }
      revise_professional_credential: {
        Args: {
          p_command_id: string
          p_credential_id: string
          p_credential_type_code: string
          p_expires_on: string
          p_idempotency_key: string
          p_identifier: string
          p_issued_on: string
          p_issuer: string
          p_name: string
          p_person_id: string
          p_request_hash: string
          p_verification_url: string
        }
        Returns: {
          credential: Json
          replayed: boolean
        }[]
      }
      revoke_access_session: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      revoke_staff_invitation: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_invitation_id: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
        }
        Returns: {
          invitation_id: string
          replayed: boolean
          status: string
        }[]
      }
      rotate_access_session: {
        Args: {
          p_access_token_expires_at: string
          p_expected_token_version: number
          p_session_id: string
          p_token_ciphertext: string
        }
        Returns: boolean
      }
      skip_onboarding_step: {
        Args: {
          p_account_id: string
          p_attempt_id: string
          p_step_code: string
        }
        Returns: undefined
      }
      start_account_recovery: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_case_reference: string
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      start_backoffice_authentication_attempt: {
        Args: {
          p_access_account_id: string
          p_access_token_expires_at: string
          p_attempt_token_hash: string
          p_expires_at: string
          p_new_factor: boolean
          p_provider_challenge_id: string
          p_provider_factor_id: string
          p_provider_session_id: string
          p_secret_ciphertext: string
          p_status: Database['identity']['Enums']['backoffice_authentication_attempt_status']
        }
        Returns: {
          attempt_id: string
          expires_at: string
          factor_id: string
          status: Database['identity']['Enums']['backoffice_authentication_attempt_status']
        }[]
      }
      start_onboarding_attempt: {
        Args: {
          p_account_id: string
          p_command_id: string
          p_idempotency_key: string
          p_request_hash: string
        }
        Returns: {
          attempt_id: string
          eligibility_status: string
          expires_at: string
          status: string
        }[]
      }
      team_invitation_projection: {
        Args: { p_invitation_id: string }
        Returns: {
          channel: string
          contact_hint: string
          expires_at: string
          invitation_id: string
          invitation_intent_id: string
          proposed_role_code: string
          status: string
        }[]
      }
      validate_professional_credential_input: {
        Args: {
          p_credential_type_code: string
          p_expires_on: string
          p_identifier: string
          p_issued_on: string
          p_issuer: string
          p_name: string
          p_verification_url: string
        }
        Returns: undefined
      }
    }
    Enums: {
      access_session_surface: 'studio' | 'backoffice'
      actor_kind: 'anonymous' | 'account' | 'person' | 'professional' | 'worker' | 'support'
      backoffice_authentication_attempt_status:
        'pending_enrollment' | 'pending_challenge' | 'completed' | 'failed' | 'expired'
      biological_sex: 'male' | 'female'
      eligibility_result: 'pass' | 'fail' | 'review_required' | 'unknown'
      identity_action_kind: 'account_recovery'
      identity_action_status:
        'initiated' | 'awaiting_verification' | 'confirmed' | 'expired' | 'cancelled' | 'failed'
      invitation_intent_kind:
        'membership' | 'service_relationship' | 'program_assignment' | 'ownership'
      invitation_intent_status: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired'
      invitation_status: 'pending' | 'completed' | 'revoked' | 'expired'
      mfa_factor_status: 'pending' | 'active' | 'revoked' | 'superseded'
      onboarding_status: 'open' | 'activated' | 'ineligible' | 'expired'
      password_reset_receipt_result: 'processed' | 'account_absent'
      person_status: 'pending_activation' | 'active' | 'closed'
      provenance:
        | 'person_declared'
        | 'professional_observation'
        | 'device_observed'
        | 'system_inferred'
        | 'authority_verified'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  organizations: {
    Tables: {
      membership_events: {
        Row: {
          after: Json | null
          before: Json | null
          created_at: string
          event_type: string
          id: string
          membership_id: string
          snapshot_schema_version: number
        }
        Insert: {
          after?: Json | null
          before?: Json | null
          created_at?: string
          event_type: string
          id?: string
          membership_id: string
          snapshot_schema_version?: number
        }
        Update: {
          after?: Json | null
          before?: Json | null
          created_at?: string
          event_type?: string
          id?: string
          membership_id?: string
          snapshot_schema_version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_membership_events_membership'
            columns: ['membership_id']
            isOneToOne: false
            referencedRelation: 'organization_memberships'
            referencedColumns: ['id']
          },
        ]
      }
      membership_roles: {
        Row: {
          id: string
          membership_id: string
          role_code: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          id?: string
          membership_id: string
          role_code: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          id?: string
          membership_id?: string
          role_code?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_membership_roles_membership'
            columns: ['membership_id']
            isOneToOne: false
            referencedRelation: 'organization_memberships'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_membership_roles_role'
            columns: ['role_code']
            isOneToOne: false
            referencedRelation: 'organization_roles'
            referencedColumns: ['code']
          },
        ]
      }
      organization_capabilities: {
        Row: {
          code: string
          name: string
        }
        Insert: {
          code: string
          name: string
        }
        Update: {
          code?: string
          name?: string
        }
        Relationships: []
      }
      organization_events: {
        Row: {
          actor_duty_assignment_id: string | null
          actor_membership_id: string | null
          actor_person_id: string | null
          after_snapshot: Json | null
          before_snapshot: Json | null
          event_type: string
          id: string
          occurred_at: string
          organization_id: string
          snapshot_schema_version: number
        }
        Insert: {
          actor_duty_assignment_id?: string | null
          actor_membership_id?: string | null
          actor_person_id?: string | null
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          event_type: string
          id?: string
          occurred_at?: string
          organization_id: string
          snapshot_schema_version?: number
        }
        Update: {
          actor_duty_assignment_id?: string | null
          actor_membership_id?: string | null
          actor_person_id?: string | null
          after_snapshot?: Json | null
          before_snapshot?: Json | null
          event_type?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          snapshot_schema_version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_organization_events_actor_membership'
            columns: ['actor_membership_id', 'organization_id']
            isOneToOne: false
            referencedRelation: 'organization_memberships'
            referencedColumns: ['id', 'organization_id']
          },
          {
            foreignKeyName: 'fk_organization_events_organization'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          joined_at: string
          organization_id: string
          person_id: string
          status: Database['organizations']['Enums']['membership_status']
          updated_at: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          joined_at?: string
          organization_id: string
          person_id: string
          status?: Database['organizations']['Enums']['membership_status']
          updated_at?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          joined_at?: string
          organization_id?: string
          person_id?: string
          status?: Database['organizations']['Enums']['membership_status']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_organization_memberships_organization'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      organization_roles: {
        Row: {
          code: string
          id: string
          name: string
        }
        Insert: {
          code: string
          id?: string
          name: string
        }
        Update: {
          code?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      organization_sites: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          revision_number: number
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          revision_number?: number
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          revision_number?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_organization_sites_organization'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      organization_type_transitions: {
        Row: {
          created_at: string
          from_type_code: string
          status: string
          to_type_code: string
        }
        Insert: {
          created_at?: string
          from_type_code: string
          status?: string
          to_type_code: string
        }
        Update: {
          created_at?: string
          from_type_code?: string
          status?: string
          to_type_code?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_organization_type_transitions_from_type'
            columns: ['from_type_code']
            isOneToOne: false
            referencedRelation: 'organization_types'
            referencedColumns: ['code']
          },
          {
            foreignKeyName: 'fk_organization_type_transitions_to_type'
            columns: ['to_type_code']
            isOneToOne: false
            referencedRelation: 'organization_types'
            referencedColumns: ['code']
          },
        ]
      }
      organization_types: {
        Row: {
          active: boolean
          code: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          code: string
          id?: string
          name: string
          sort_order: number
        }
        Update: {
          active?: boolean
          code?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      organizations: {
        Row: {
          cancelled_at: string | null
          claimed_at: string | null
          created_at: string
          display_name: string
          id: string
          legal_name: string | null
          responsible_party: Json
          responsible_party_schema_version: number
          revision_number: number
          status: Database['organizations']['Enums']['organization_status']
          type_code: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          claimed_at?: string | null
          created_at?: string
          display_name: string
          id?: string
          legal_name?: string | null
          responsible_party: Json
          responsible_party_schema_version?: number
          revision_number?: number
          status?: Database['organizations']['Enums']['organization_status']
          type_code: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          claimed_at?: string | null
          created_at?: string
          display_name?: string
          id?: string
          legal_name?: string | null
          responsible_party?: Json
          responsible_party_schema_version?: number
          revision_number?: number
          status?: Database['organizations']['Enums']['organization_status']
          type_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_organizations_type'
            columns: ['type_code']
            isOneToOne: false
            referencedRelation: 'organization_types'
            referencedColumns: ['code']
          },
        ]
      }
      role_capabilities: {
        Row: {
          capability_code: string
          role_code: string
        }
        Insert: {
          capability_code: string
          role_code: string
        }
        Update: {
          capability_code?: string
          role_code?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_role_capabilities_capability'
            columns: ['capability_code']
            isOneToOne: false
            referencedRelation: 'organization_capabilities'
            referencedColumns: ['code']
          },
          {
            foreignKeyName: 'fk_role_capabilities_role'
            columns: ['role_code']
            isOneToOne: false
            referencedRelation: 'organization_roles'
            referencedColumns: ['code']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cancel_unclaimed_organization: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      create_organization: {
        Args: {
          p_command_id: string
          p_display_name: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
          p_responsible_party_kind: string
          p_responsible_party_name: string
          p_type_code: string
        }
        Returns: {
          display_name: string
          membership_id: string
          organization_id: string
          role_code: string
          type_code: string
        }[]
      }
      create_site: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
          p_site: Json
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      create_unclaimed_organization: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_display_name: string
          p_idempotency_key: string
          p_legal_name: string
          p_owner_email: string
          p_party_kind: string
          p_request_hash: string
          p_site_address: string
          p_site_name: string
          p_token_hash: string
          p_token_key_version: number
          p_type_code: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      grant_membership_role: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_membership_id: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
          p_role_code: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      handover_projection: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      list_backoffice_organizations: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_after_id: string
          p_after_name: string
          p_limit: number
          p_query: string
          p_status: string
        }
        Returns: {
          active_member_count: number
          cancelled_at: string
          claimed_at: string
          created_at: string
          display_name: string
          organization_id: string
          people_served: number
          site_count: number
          status: string
          type_code: string
          type_name: string
        }[]
      }
      list_my_memberships: {
        Args: { p_person_id: string }
        Returns: {
          display_name: string
          ended_at: string
          joined_at: string
          membership_id: string
          organization_id: string
          roles: string[]
          status: string
          type_code: string
        }[]
      }
      list_organization_memberships: {
        Args: {
          p_cursor_display_name: string
          p_cursor_membership_id: string
          p_cursor_status: string
          p_limit: number
          p_organization_id: string
          p_person_id: string
          p_status: string
        }
        Returns: {
          display_name: string
          ended_at: string
          joined_at: string
          membership_id: string
          roles: string[]
          sort_display_name: string
          status: string
        }[]
      }
      list_organization_roles: {
        Args: { p_organization_id: string; p_person_id: string }
        Returns: {
          capability_code: string
          capability_name: string
          role_code: string
          role_name: string
        }[]
      }
      list_organization_types: {
        Args: never
        Returns: {
          code: string
          name: string
        }[]
      }
      organization_projection: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      read_backoffice_organization: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      read_organization: { Args: { p_organization_id: string }; Returns: Json }
      read_organization_handover: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      require_organization_directory_reader: {
        Args: { p_actor_person_id: string; p_actor_session_id: string }
        Returns: undefined
      }
      require_organization_lifecycle_duty: {
        Args: { p_actor_person_id: string; p_actor_session_id: string }
        Returns: string
      }
      resend_ownership_invitation: {
        Args: {
          p_actor_person_id: string
          p_actor_session_id: string
          p_command_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_request_hash: string
          p_token_hash: string
          p_token_key_version: number
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      site_projection: { Args: { p_site_id: string }; Returns: Json }
      transfer_ownership: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
          p_target_membership_id: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      update_organization: {
        Args: {
          p_command_id: string
          p_expected_revision: number
          p_idempotency_key: string
          p_organization_id: string
          p_patch: Json
          p_person_id: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      update_site: {
        Args: {
          p_command_id: string
          p_expected_revision: number
          p_idempotency_key: string
          p_organization_id: string
          p_patch: Json
          p_person_id: string
          p_request_hash: string
          p_site_id: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      validate_membership_event_snapshot: {
        Args: {
          p_event_type: string
          p_payload: Json
          p_schema_version: number
        }
        Returns: boolean
      }
      validate_organization_event_snapshot: {
        Args: {
          p_event_type: string
          p_payload: Json
          p_schema_version: number
        }
        Returns: boolean
      }
    }
    Enums: {
      membership_status: 'active' | 'terminated'
      organization_status: 'unclaimed' | 'active' | 'closed' | 'cancelled'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  planning: {
    Tables: {
      endurance_targets: {
        Row: {
          id: string
          planned_step_id: string
          target_distance_unit_code: string | null
          target_distance_value: number | null
          target_duration_seconds: number | null
          target_pace_seconds_per_unit: number | null
          target_pace_unit_code: string | null
        }
        Insert: {
          id?: string
          planned_step_id: string
          target_distance_unit_code?: string | null
          target_distance_value?: number | null
          target_duration_seconds?: number | null
          target_pace_seconds_per_unit?: number | null
          target_pace_unit_code?: string | null
        }
        Update: {
          id?: string
          planned_step_id?: string
          target_distance_unit_code?: string | null
          target_distance_value?: number | null
          target_duration_seconds?: number | null
          target_pace_seconds_per_unit?: number | null
          target_pace_unit_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_endurance_targets_step'
            columns: ['planned_step_id']
            isOneToOne: true
            referencedRelation: 'planned_steps'
            referencedColumns: ['id']
          },
        ]
      }
      interval_targets: {
        Row: {
          id: string
          planned_step_id: string
          rest_duration_seconds: number | null
          rounds: number
          target_rpe: number | null
          work_duration_seconds: number
        }
        Insert: {
          id?: string
          planned_step_id: string
          rest_duration_seconds?: number | null
          rounds: number
          target_rpe?: number | null
          work_duration_seconds: number
        }
        Update: {
          id?: string
          planned_step_id?: string
          rest_duration_seconds?: number | null
          rounds?: number
          target_rpe?: number | null
          work_duration_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_interval_targets_step'
            columns: ['planned_step_id']
            isOneToOne: true
            referencedRelation: 'planned_steps'
            referencedColumns: ['id']
          },
        ]
      }
      mobility_targets: {
        Row: {
          hold_duration_seconds: number | null
          id: string
          planned_step_id: string
          sequence_position: number
          side: string
          target_repetitions: number | null
        }
        Insert: {
          hold_duration_seconds?: number | null
          id?: string
          planned_step_id: string
          sequence_position: number
          side: string
          target_repetitions?: number | null
        }
        Update: {
          hold_duration_seconds?: number | null
          id?: string
          planned_step_id?: string
          sequence_position?: number
          side?: string
          target_repetitions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_mobility_targets_step'
            columns: ['planned_step_id']
            isOneToOne: true
            referencedRelation: 'planned_steps'
            referencedColumns: ['id']
          },
        ]
      }
      planned_sessions: {
        Row: {
          assignment_id: string
          id: string
          person_id: string
          program_day: number
          scheduled_at: string
          status: string
          template_version_id: string
          timezone: string
          week_starts_on: string
        }
        Insert: {
          assignment_id: string
          id?: string
          person_id: string
          program_day: number
          scheduled_at: string
          status?: string
          template_version_id: string
          timezone: string
          week_starts_on: string
        }
        Update: {
          assignment_id?: string
          id?: string
          person_id?: string
          program_day?: number
          scheduled_at?: string
          status?: string
          template_version_id?: string
          timezone?: string
          week_starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_planned_sessions_assignment'
            columns: ['assignment_id', 'person_id']
            isOneToOne: false
            referencedRelation: 'program_assignments'
            referencedColumns: ['id', 'person_id']
          },
          {
            foreignKeyName: 'fk_planned_sessions_template_version'
            columns: ['template_version_id']
            isOneToOne: false
            referencedRelation: 'session_template_versions'
            referencedColumns: ['id']
          },
        ]
      }
      planned_sets: {
        Row: {
          created_at: string
          id: string
          kind: Database['planning']['Enums']['set_kind']
          planned_step_id: string
          set_order: number
          target_load_unit_code: string | null
          target_load_value: number | null
          target_reps: number | null
          target_rpe: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: Database['planning']['Enums']['set_kind']
          planned_step_id: string
          set_order: number
          target_load_unit_code?: string | null
          target_load_value?: number | null
          target_reps?: number | null
          target_rpe?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database['planning']['Enums']['set_kind']
          planned_step_id?: string
          set_order?: number
          target_load_unit_code?: string | null
          target_load_value?: number | null
          target_reps?: number | null
          target_rpe?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_planned_sets_step'
            columns: ['planned_step_id']
            isOneToOne: false
            referencedRelation: 'planned_steps'
            referencedColumns: ['id']
          },
        ]
      }
      planned_steps: {
        Row: {
          activity_type_id: string | null
          id: string
          movement_id: string | null
          notes: string | null
          position: number
          superset_group: number | null
          template_version_id: string
        }
        Insert: {
          activity_type_id?: string | null
          id?: string
          movement_id?: string | null
          notes?: string | null
          position: number
          superset_group?: number | null
          template_version_id: string
        }
        Update: {
          activity_type_id?: string | null
          id?: string
          movement_id?: string | null
          notes?: string | null
          position?: number
          superset_group?: number | null
          template_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_planned_steps_template_version'
            columns: ['template_version_id']
            isOneToOne: false
            referencedRelation: 'session_template_versions'
            referencedColumns: ['id']
          },
        ]
      }
      program_assignments: {
        Row: {
          assigned_at: string
          display_order: number
          id: string
          lifecycle: Database['planning']['Enums']['assignment_lifecycle']
          origin_relationship_id: string | null
          person_id: string
          program_version_id: string
          starts_on: string
          timezone: string
        }
        Insert: {
          assigned_at?: string
          display_order: number
          id?: string
          lifecycle: Database['planning']['Enums']['assignment_lifecycle']
          origin_relationship_id?: string | null
          person_id: string
          program_version_id: string
          starts_on: string
          timezone: string
        }
        Update: {
          assigned_at?: string
          display_order?: number
          id?: string
          lifecycle?: Database['planning']['Enums']['assignment_lifecycle']
          origin_relationship_id?: string | null
          person_id?: string
          program_version_id?: string
          starts_on?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_program_assignments_version'
            columns: ['program_version_id']
            isOneToOne: false
            referencedRelation: 'program_versions'
            referencedColumns: ['id']
          },
        ]
      }
      program_cover_photos: {
        Row: {
          audience: Database['identity']['Enums']['biological_sex']
          byte_size: number | null
          checksum: string | null
          content_type: string | null
          height: number | null
          object_key: string
          program_id: string
          width: number | null
        }
        Insert: {
          audience: Database['identity']['Enums']['biological_sex']
          byte_size?: number | null
          checksum?: string | null
          content_type?: string | null
          height?: number | null
          object_key: string
          program_id: string
          width?: number | null
        }
        Update: {
          audience?: Database['identity']['Enums']['biological_sex']
          byte_size?: number | null
          checksum?: string | null
          content_type?: string | null
          height?: number | null
          object_key?: string
          program_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_program_cover_photos_program'
            columns: ['program_id']
            isOneToOne: false
            referencedRelation: 'programs'
            referencedColumns: ['id']
          },
        ]
      }
      program_drafts: {
        Row: {
          content: Json
          content_schema_version: number
          id: string
          program_id: string
          updated_at: string
        }
        Insert: {
          content: Json
          content_schema_version?: number
          id?: string
          program_id: string
          updated_at?: string
        }
        Update: {
          content?: Json
          content_schema_version?: number
          id?: string
          program_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_program_drafts_program'
            columns: ['program_id']
            isOneToOne: true
            referencedRelation: 'programs'
            referencedColumns: ['id']
          },
        ]
      }
      program_version_emphases: {
        Row: {
          focus_area_code: string
          program_version_id: string
        }
        Insert: {
          focus_area_code: string
          program_version_id: string
        }
        Update: {
          focus_area_code?: string
          program_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_program_version_emphases_version'
            columns: ['program_version_id']
            isOneToOne: false
            referencedRelation: 'program_versions'
            referencedColumns: ['id']
          },
        ]
      }
      program_version_goals: {
        Row: {
          goal_code: string
          program_version_id: string
        }
        Insert: {
          goal_code: string
          program_version_id: string
        }
        Update: {
          goal_code?: string
          program_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_program_version_goals_version'
            columns: ['program_version_id']
            isOneToOne: false
            referencedRelation: 'program_versions'
            referencedColumns: ['id']
          },
        ]
      }
      program_version_levels: {
        Row: {
          experience_code: string
          program_version_id: string
        }
        Insert: {
          experience_code: string
          program_version_id: string
        }
        Update: {
          experience_code?: string
          program_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_program_version_levels_version'
            columns: ['program_version_id']
            isOneToOne: false
            referencedRelation: 'program_versions'
            referencedColumns: ['id']
          },
        ]
      }
      program_version_sessions: {
        Row: {
          day: number
          id: string
          position: number
          program_version_id: string
          template_version_id: string
          week: number
        }
        Insert: {
          day: number
          id?: string
          position: number
          program_version_id: string
          template_version_id: string
          week: number
        }
        Update: {
          day?: number
          id?: string
          position?: number
          program_version_id?: string
          template_version_id?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_program_version_sessions_program_version'
            columns: ['program_version_id']
            isOneToOne: false
            referencedRelation: 'program_versions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_program_version_sessions_template_version'
            columns: ['template_version_id']
            isOneToOne: false
            referencedRelation: 'session_template_versions'
            referencedColumns: ['id']
          },
        ]
      }
      program_versions: {
        Row: {
          content_hash: string
          id: string
          notes: string | null
          program_id: string
          published_at: string
          repeats_forever: boolean
          sex_affinity: Database['identity']['Enums']['biological_sex'] | null
          status: Database['catalog']['Enums']['publication_status']
          title: string
          version_number: number
        }
        Insert: {
          content_hash: string
          id?: string
          notes?: string | null
          program_id: string
          published_at?: string
          repeats_forever?: boolean
          sex_affinity?: Database['identity']['Enums']['biological_sex'] | null
          status?: Database['catalog']['Enums']['publication_status']
          title: string
          version_number: number
        }
        Update: {
          content_hash?: string
          id?: string
          notes?: string | null
          program_id?: string
          published_at?: string
          repeats_forever?: boolean
          sex_affinity?: Database['identity']['Enums']['biological_sex'] | null
          status?: Database['catalog']['Enums']['publication_status']
          title?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_program_versions_program'
            columns: ['program_id']
            isOneToOne: false
            referencedRelation: 'programs'
            referencedColumns: ['id']
          },
        ]
      }
      programs: {
        Row: {
          author_person_id: string | null
          content_scope: Database['catalog']['Enums']['content_scope']
          cover_from_program_id: string | null
          created_at: string
          id: string
          owner_organization_id: string | null
          owner_person_id: string | null
          routine_cover_icon: Database['planning']['Enums']['routine_cover_icon'] | null
          routine_cover_kind: Database['planning']['Enums']['routine_cover'] | null
          status: Database['catalog']['Enums']['publication_status']
          updated_at: string
        }
        Insert: {
          author_person_id?: string | null
          content_scope: Database['catalog']['Enums']['content_scope']
          cover_from_program_id?: string | null
          created_at?: string
          id?: string
          owner_organization_id?: string | null
          owner_person_id?: string | null
          routine_cover_icon?: Database['planning']['Enums']['routine_cover_icon'] | null
          routine_cover_kind?: Database['planning']['Enums']['routine_cover'] | null
          status?: Database['catalog']['Enums']['publication_status']
          updated_at?: string
        }
        Update: {
          author_person_id?: string | null
          content_scope?: Database['catalog']['Enums']['content_scope']
          cover_from_program_id?: string | null
          created_at?: string
          id?: string
          owner_organization_id?: string | null
          owner_person_id?: string | null
          routine_cover_icon?: Database['planning']['Enums']['routine_cover_icon'] | null
          routine_cover_kind?: Database['planning']['Enums']['routine_cover'] | null
          status?: Database['catalog']['Enums']['publication_status']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_programs_cover_from_program'
            columns: ['cover_from_program_id']
            isOneToOne: false
            referencedRelation: 'programs'
            referencedColumns: ['id']
          },
        ]
      }
      session_template_drafts: {
        Row: {
          content: Json
          content_schema_version: number
          derived_from_version_id: string | null
          id: string
          template_id: string
          updated_at: string
        }
        Insert: {
          content: Json
          content_schema_version?: number
          derived_from_version_id?: string | null
          id?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          content?: Json
          content_schema_version?: number
          derived_from_version_id?: string | null
          id?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_session_template_drafts_derivation'
            columns: ['derived_from_version_id']
            isOneToOne: false
            referencedRelation: 'session_template_versions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_session_template_drafts_template'
            columns: ['template_id']
            isOneToOne: true
            referencedRelation: 'session_templates'
            referencedColumns: ['id']
          },
        ]
      }
      session_template_versions: {
        Row: {
          activity_type_id: string
          content_hash: string
          derived_from_version_id: string | null
          discipline_code: string
          id: string
          published_at: string
          status: Database['catalog']['Enums']['publication_status']
          template_id: string
          title: string
          version_number: number
        }
        Insert: {
          activity_type_id: string
          content_hash: string
          derived_from_version_id?: string | null
          discipline_code: string
          id?: string
          published_at?: string
          status?: Database['catalog']['Enums']['publication_status']
          template_id: string
          title: string
          version_number: number
        }
        Update: {
          activity_type_id?: string
          content_hash?: string
          derived_from_version_id?: string | null
          discipline_code?: string
          id?: string
          published_at?: string
          status?: Database['catalog']['Enums']['publication_status']
          template_id?: string
          title?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_session_template_versions_derivation'
            columns: ['derived_from_version_id']
            isOneToOne: false
            referencedRelation: 'session_template_versions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_session_template_versions_template'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'session_templates'
            referencedColumns: ['id']
          },
        ]
      }
      session_templates: {
        Row: {
          author_person_id: string | null
          content_scope: Database['catalog']['Enums']['content_scope']
          created_at: string
          discipline_code: string
          id: string
          owner_organization_id: string | null
          owner_person_id: string | null
          status: Database['catalog']['Enums']['publication_status']
          updated_at: string
        }
        Insert: {
          author_person_id?: string | null
          content_scope: Database['catalog']['Enums']['content_scope']
          created_at?: string
          discipline_code: string
          id?: string
          owner_organization_id?: string | null
          owner_person_id?: string | null
          status?: Database['catalog']['Enums']['publication_status']
          updated_at?: string
        }
        Update: {
          author_person_id?: string | null
          content_scope?: Database['catalog']['Enums']['content_scope']
          created_at?: string
          discipline_code?: string
          id?: string
          owner_organization_id?: string | null
          owner_person_id?: string | null
          status?: Database['catalog']['Enums']['publication_status']
          updated_at?: string
        }
        Relationships: []
      }
      strength_targets: {
        Row: {
          id: string
          planned_step_id: string
          target_load_unit_code: string | null
          target_load_value: number | null
          target_reps: number | null
          target_rest_seconds: number | null
          target_rpe: number | null
          target_sets: number
        }
        Insert: {
          id?: string
          planned_step_id: string
          target_load_unit_code?: string | null
          target_load_value?: number | null
          target_reps?: number | null
          target_rest_seconds?: number | null
          target_rpe?: number | null
          target_sets: number
        }
        Update: {
          id?: string
          planned_step_id?: string
          target_load_unit_code?: string | null
          target_load_value?: number | null
          target_reps?: number | null
          target_rest_seconds?: number | null
          target_rpe?: number | null
          target_sets?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_strength_targets_step'
            columns: ['planned_step_id']
            isOneToOne: true
            referencedRelation: 'planned_steps'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_deprecate_content: {
        Args: { p_organization_id: string; p_person_id: string }
        Returns: string
      }
      assert_manage_content: {
        Args: { p_organization_id: string; p_person_id: string }
        Returns: string
      }
      assert_own_content: { Args: { p_person_id: string }; Returns: undefined }
      audit_organization_read: {
        Args: { p_organization_id: string; p_person_id: string }
        Returns: undefined
      }
      canonical_program_content: { Args: { p_content: Json }; Returns: Json }
      canonical_session_content: { Args: { p_content: Json }; Returns: Json }
      canonical_target: { Args: { p_target: Json }; Returns: Json }
      content_etag: { Args: { p_content: Json }; Returns: string }
      cover_for: {
        Args: { p_person_id: string; p_program_id: string }
        Returns: string
      }
      create_my_program: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
          p_title: string
        }
        Returns: {
          program: Json
          replayed: boolean
        }[]
      }
      create_my_session_template: {
        Args: {
          p_command_id: string
          p_discipline_code: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
          p_title: string
        }
        Returns: {
          replayed: boolean
          template: Json
        }[]
      }
      create_program: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
          p_title: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      create_session_template: {
        Args: {
          p_command_id: string
          p_discipline_code: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
          p_title: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      deprecate_program_version: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_program_id: string
          p_request_hash: string
          p_version_number: number
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      deprecate_session_template_version: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
          p_template_id: string
          p_version_number: number
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      derive_session_template_version: {
        Args: {
          p_command_id: string
          p_expected_etag: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
          p_template_id: string
          p_version_number: number
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      discard_my_program: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_program_id: string
          p_request_hash: string
        }
        Returns: {
          program: Json
          replayed: boolean
        }[]
      }
      discard_my_session_template: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
          p_template_id: string
        }
        Returns: {
          replayed: boolean
          template: Json
        }[]
      }
      duplicate_my_program: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_program_id: string
          p_request_hash: string
        }
        Returns: {
          program: Json
          replayed: boolean
        }[]
      }
      fork_program_version: {
        Args: { p_person_id: string; p_program_version_id: string }
        Returns: string
      }
      list_programs: {
        Args: {
          p_cursor_id: string
          p_cursor_updated_at: string
          p_limit: number
          p_organization_id: string
          p_person_id: string
        }
        Returns: {
          program_id: string
          result: Json
          updated_at: string
        }[]
      }
      list_session_templates: {
        Args: {
          p_cursor_id: string
          p_cursor_updated_at: string
          p_limit: number
          p_organization_id: string
          p_person_id: string
        }
        Returns: {
          result: Json
          template_id: string
          updated_at: string
        }[]
      }
      lock_program_template_versions: {
        Args: { p_content: Json; p_organization_id: string }
        Returns: undefined
      }
      materialize_target: {
        Args: { p_step_id: string; p_target: Json }
        Returns: undefined
      }
      pick_program_cover: { Args: { p_program_id: string }; Returns: string }
      pick_routine_cover: {
        Args: { p_person_id: string; p_region: string; p_template_id: string }
        Returns: string
      }
      planned_set_errors: { Args: { p_sets: Json }; Returns: string[] }
      plant_my_open_week: {
        Args: { p_person_id: string; p_timezone: string }
        Returns: undefined
      }
      program_content_errors: {
        Args: {
          p_content: Json
          p_organization_id: string
          p_require_publishable: boolean
        }
        Returns: string[]
      }
      program_draft_projection: { Args: { p_draft_id: string }; Returns: Json }
      program_projection: { Args: { p_program_id: string }; Returns: Json }
      program_region: { Args: { p_program_id: string }; Returns: string }
      program_regions: {
        Args: { p_program_ids: string[] }
        Returns: {
          program_id: string
          region: string
        }[]
      }
      program_version_projection: {
        Args: { p_version_id: string }
        Returns: Json
      }
      publish_global_program: {
        Args: {
          p_content: Json
          p_emphases: string[]
          p_goals: string[]
          p_levels: string[]
          p_program_id: string
          p_sex_affinity: Database['identity']['Enums']['biological_sex']
        }
        Returns: string
      }
      publish_global_session_template: {
        Args: {
          p_content: Json
          p_discipline_code: string
          p_template_id: string
        }
        Returns: string
      }
      publish_my_program: {
        Args: {
          p_command_id: string
          p_expected_etag: string
          p_idempotency_key: string
          p_person_id: string
          p_program_id: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          version: Json
        }[]
      }
      publish_my_session_template: {
        Args: {
          p_command_id: string
          p_expected_etag: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
          p_template_id: string
        }
        Returns: {
          replayed: boolean
          version: Json
        }[]
      }
      publish_program_content: {
        Args: { p_content: Json; p_program_id: string }
        Returns: string
      }
      publish_program_version: {
        Args: {
          p_command_id: string
          p_expected_etag: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_program_id: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      publish_session_template_version: {
        Args: {
          p_command_id: string
          p_expected_etag: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
          p_template_id: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      read_current_assignment: {
        Args: { p_person_id: string }
        Returns: {
          assignment_id: string
          program_version_id: string
          sessions_planned: number
          starts_on: string
          timezone: string
          title: string
        }[]
      }
      read_my_content: { Args: { p_person_id: string }; Returns: Json }
      read_my_program_draft: {
        Args: { p_person_id: string; p_program_id: string }
        Returns: Json
      }
      read_my_programs: {
        Args: { p_person_id: string }
        Returns: {
          assignment_id: string
          cover_object_key: string
          days_per_week: number
          editable: boolean
          program_id: string
          program_version_id: string
          routine_cover: Json
          sessions_done: number
          sessions_planned: number
          starts_on: string
          title: string
          weeks: number
        }[]
      }
      read_my_session_template_draft: {
        Args: { p_person_id: string; p_template_id: string }
        Returns: Json
      }
      read_my_unpublished_program: {
        Args: { p_person_id: string }
        Returns: Json
      }
      read_program_catalogue: {
        Args: { p_person_id: string }
        Returns: {
          cover_object_key: string
          days_per_week: number
          emphases: string[]
          goals: string[]
          levels: string[]
          program_id: string
          program_version_id: string
          sex_affinity: string
          title: string
          weeks: number
        }[]
      }
      read_program_version: {
        Args: { p_person_id: string; p_program_version_id: string }
        Returns: {
          cover_object_key: string
          days: Json
          days_per_week: number
          emphases: string[]
          goals: string[]
          levels: string[]
          notes: string
          program_version_id: string
          sex_affinity: string
          title: string
          weeks: number
        }[]
      }
      read_session_template_draft: {
        Args: {
          p_organization_id: string
          p_person_id: string
          p_template_id: string
        }
        Returns: Json
      }
      read_session_template_version: {
        Args: {
          p_organization_id: string
          p_person_id: string
          p_template_id: string
          p_version_number: number
        }
        Returns: Json
      }
      read_today_session: {
        Args: { p_person_id: string; p_timezone: string }
        Returns: {
          assignment_id: string
          discipline_code: string
          executed_session_id: string
          execution_status: string
          exercise_count: number
          planned_session_id: string
          program_title: string
          scheduled_on: string
          session_title: string
          status: string
        }[]
      }
      read_week_plan: {
        Args: { p_person_id: string; p_timezone: string }
        Returns: {
          assignment_id: string
          program_title: string
          program_version_id: string
          program_week: number
          sessions: Json
          week_starts_on: string
        }[]
      }
      region_of_content: { Args: { p_content: Json }; Returns: string }
      region_of_version: {
        Args: { p_template_version_id: string }
        Returns: string
      }
      remove_my_program: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_program_id: string
          p_request_hash: string
          p_with_routines: boolean
        }
        Returns: {
          program: Json
          replayed: boolean
        }[]
      }
      reorder_my_programs: {
        Args: {
          p_assignment_ids: string[]
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
        }
        Returns: number
      }
      replace_my_program_draft: {
        Args: {
          p_command_id: string
          p_content: Json
          p_expected_etag: string
          p_idempotency_key: string
          p_person_id: string
          p_program_id: string
          p_request_hash: string
        }
        Returns: {
          draft: Json
          replayed: boolean
        }[]
      }
      replace_my_session_template_draft: {
        Args: {
          p_command_id: string
          p_content: Json
          p_expected_etag: string
          p_idempotency_key: string
          p_person_id: string
          p_request_hash: string
          p_template_id: string
        }
        Returns: {
          draft: Json
          replayed: boolean
        }[]
      }
      replace_program_draft: {
        Args: {
          p_command_id: string
          p_content: Json
          p_expected_etag: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_program_id: string
          p_request_hash: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      replace_session_template_draft: {
        Args: {
          p_command_id: string
          p_content: Json
          p_expected_etag: string
          p_idempotency_key: string
          p_organization_id: string
          p_person_id: string
          p_request_hash: string
          p_template_id: string
        }
        Returns: {
          replayed: boolean
          result: Json
        }[]
      }
      restate_assignment_onto: {
        Args: { p_person_id: string; p_program_version_id: string }
        Returns: string
      }
      restate_my_program_assignment: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_program_version_id: string
          p_request_hash: string
        }
        Returns: string
      }
      self_assign_program: {
        Args: {
          p_command_id: string
          p_idempotency_key: string
          p_person_id: string
          p_program_version_id: string
          p_request_hash: string
          p_timezone: string
        }
        Returns: string
      }
      session_content_errors: {
        Args: {
          p_content: Json
          p_discipline_code: string
          p_organization_id: string
          p_require_complete: boolean
        }
        Returns: string[]
      }
      session_draft_projection: { Args: { p_draft_id: string }; Returns: Json }
      session_template_projection: {
        Args: { p_template_id: string }
        Returns: Json
      }
      session_version_projection: {
        Args: { p_version_id: string }
        Returns: Json
      }
      set_my_program_cover: {
        Args: {
          p_command_id: string
          p_icon: string
          p_idempotency_key: string
          p_kind: string
          p_person_id: string
          p_program_id: string
          p_request_hash: string
        }
        Returns: Json
      }
    }
    Enums: {
      assignment_lifecycle: 'active' | 'detached_pending_choice' | 'personal' | 'ended'
      routine_cover: 'muscles' | 'icon' | 'photo'
      routine_cover_icon:
        | 'strength'
        | 'run'
        | 'cycling'
        | 'interval'
        | 'cardio'
        | 'burn'
        | 'power'
        | 'challenge'
        | 'mountain'
        | 'time'
        | 'mobility'
        | 'swim'
        | 'arms'
        | 'weights'
        | 'technique'
        | 'endurance'
        | 'pace'
        | 'energy'
        | 'focus'
        | 'recovery'
        | 'morning'
        | 'evening'
        | 'night'
        | 'cold'
        | 'outdoor'
        | 'route'
        | 'pool'
        | 'team'
        | 'record'
        | 'favourite'
        | 'light'
        | 'countdown'
      set_kind: 'normal' | 'warmup' | 'to_failure' | 'drop'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  access_control: {
    Enums: {},
  },
  catalog: {
    Enums: {
      activity_family: ['strength', 'endurance', 'interval', 'mobility'],
      completeness_level: ['partial', 'summary', 'detailed', 'sensor_enriched'],
      content_scope: ['global', 'organization', 'person'],
      publication_status: ['draft', 'published', 'deprecated', 'archived'],
    },
  },
  identity: {
    Enums: {
      access_session_surface: ['studio', 'backoffice'],
      actor_kind: ['anonymous', 'account', 'person', 'professional', 'worker', 'support'],
      backoffice_authentication_attempt_status: [
        'pending_enrollment',
        'pending_challenge',
        'completed',
        'failed',
        'expired',
      ],
      biological_sex: ['male', 'female'],
      eligibility_result: ['pass', 'fail', 'review_required', 'unknown'],
      identity_action_kind: ['account_recovery'],
      identity_action_status: [
        'initiated',
        'awaiting_verification',
        'confirmed',
        'expired',
        'cancelled',
        'failed',
      ],
      invitation_intent_kind: [
        'membership',
        'service_relationship',
        'program_assignment',
        'ownership',
      ],
      invitation_intent_status: ['pending', 'accepted', 'rejected', 'revoked', 'expired'],
      invitation_status: ['pending', 'completed', 'revoked', 'expired'],
      mfa_factor_status: ['pending', 'active', 'revoked', 'superseded'],
      onboarding_status: ['open', 'activated', 'ineligible', 'expired'],
      password_reset_receipt_result: ['processed', 'account_absent'],
      person_status: ['pending_activation', 'active', 'closed'],
      provenance: [
        'person_declared',
        'professional_observation',
        'device_observed',
        'system_inferred',
        'authority_verified',
      ],
    },
  },
  organizations: {
    Enums: {
      membership_status: ['active', 'terminated'],
      organization_status: ['unclaimed', 'active', 'closed', 'cancelled'],
    },
  },
  planning: {
    Enums: {
      assignment_lifecycle: ['active', 'detached_pending_choice', 'personal', 'ended'],
      routine_cover: ['muscles', 'icon', 'photo'],
      routine_cover_icon: [
        'strength',
        'run',
        'cycling',
        'interval',
        'cardio',
        'burn',
        'power',
        'challenge',
        'mountain',
        'time',
        'mobility',
        'swim',
        'arms',
        'weights',
        'technique',
        'endurance',
        'pace',
        'energy',
        'focus',
        'recovery',
        'morning',
        'evening',
        'night',
        'cold',
        'outdoor',
        'route',
        'pool',
        'team',
        'record',
        'favourite',
        'light',
        'countdown',
      ],
      set_kind: ['normal', 'warmup', 'to_failure', 'drop'],
    },
  },
} as const
