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
      has_capability: {
        Args: { p_capability_code: string; p_organization_id: string }
        Returns: boolean
      }
      has_membership: { Args: { p_organization_id: string }; Returns: boolean }
      has_platform_duty: {
        Args: { p_duty_code: string; p_person_id: string; p_session_id: string }
        Returns: boolean
      }
      is_self: { Args: { target_person_id: string }; Returns: boolean }
      owns_membership: { Args: { p_membership_id: string }; Returns: boolean }
      person: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
      invitation_intents: {
        Row: {
          created_at: string
          decided_at: string | null
          id: string
          invitation_id: string
          kind: Database['identity']['Enums']['invitation_intent_kind']
          materialized_membership_id: string | null
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
      invitations: {
        Row: {
          channel: string
          contact: string
          created_at: string
          expires_at: string
          id: string
          issued_by_membership_id: string
          organization_id: string
          proposal_hash: string
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
          issued_by_membership_id: string
          organization_id: string
          proposal_hash: string
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
          issued_by_membership_id?: string
          organization_id?: string
          proposal_hash?: string
          responsible_party?: Json
          responsible_party_schema_version?: number
          status?: Database['identity']['Enums']['invitation_status']
          token_hash?: string
          token_key_version?: number
          updated_at?: string
        }
        Relationships: []
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
          activated_at: string
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
        }
        Insert: {
          activated_at?: string
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
        }
        Update: {
          activated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      bind_backoffice_totp_verification: {
        Args: {
          p_attempt_token_hash: string
          p_command_id: string
          p_idempotency_key: string
        }
        Returns: undefined
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
      expire_backoffice_authentication_attempts: {
        Args: { p_limit: number }
        Returns: number
      }
      expire_staff_invitations: { Args: { p_limit?: number }; Returns: number }
      get_my_professional_context: {
        Args: { p_person_id: string; p_request_id: string }
        Returns: Json
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
      prepare_backoffice_auth_cleanup: {
        Args: { p_event_id: string }
        Returns: {
          cleanup_state: string
          provider_factor_id: string
          provider_session_id: string
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
      recover_backoffice_totp_factor: {
        Args: {
          p_approved_by_person_id: string
          p_ceremony_reference: string
          p_requested_by_person_id: string
          p_subject_person_id: string
        }
        Returns: string
      }
      require_professional_actor: {
        Args: { p_person_id: string }
        Returns: undefined
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
      resolve_or_create_access_account: {
        Args: { p_issuer: string; p_provider: string; p_subject: string }
        Returns: {
          account_id: string
          person_id: string
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
      eligibility_result: 'pass' | 'fail' | 'review_required' | 'unknown'
      invitation_intent_kind: 'membership' | 'service_relationship' | 'program_assignment'
      invitation_intent_status: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired'
      invitation_status: 'pending' | 'completed' | 'revoked' | 'expired'
      mfa_factor_status: 'pending' | 'active' | 'revoked' | 'superseded'
      onboarding_status: 'open' | 'activated' | 'ineligible' | 'expired'
      password_reset_receipt_result: 'processed' | 'account_absent'
      person_status: 'active' | 'closed'
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
      eligibility_result: ['pass', 'fail', 'review_required', 'unknown'],
      invitation_intent_kind: ['membership', 'service_relationship', 'program_assignment'],
      invitation_intent_status: ['pending', 'accepted', 'rejected', 'revoked', 'expired'],
      invitation_status: ['pending', 'completed', 'revoked', 'expired'],
      mfa_factor_status: ['pending', 'active', 'revoked', 'superseded'],
      onboarding_status: ['open', 'activated', 'ineligible', 'expired'],
      password_reset_receipt_result: ['processed', 'account_absent'],
      person_status: ['active', 'closed'],
    },
  },
} as const
