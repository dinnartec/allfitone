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
      is_self: { Args: { target_person_id: string }; Returns: boolean }
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
          access_account_id: string
          access_token_expires_at: string
          created_at: string
          id: string
          provider_session_id: string
          revoked_at: string | null
          surface: Database['identity']['Enums']['access_session_surface']
          token_ciphertext: string
          token_hash: string
          token_version: number
          updated_at: string
        }
        Insert: {
          access_account_id: string
          access_token_expires_at: string
          created_at?: string
          id?: string
          provider_session_id: string
          revoked_at?: string | null
          surface: Database['identity']['Enums']['access_session_surface']
          token_ciphertext: string
          token_hash: string
          token_version?: number
          updated_at?: string
        }
        Update: {
          access_account_id?: string
          access_token_expires_at?: string
          created_at?: string
          id?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      resolve_or_create_access_account: {
        Args: { p_issuer: string; p_provider: string; p_subject: string }
        Returns: {
          account_id: string
          person_id: string
        }[]
      }
      revoke_access_session: {
        Args: { p_session_id: string }
        Returns: boolean
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
    }
    Enums: {
      access_session_surface: 'studio'
      actor_kind: 'anonymous' | 'account' | 'person' | 'professional' | 'worker' | 'support'
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
      access_session_surface: ['studio'],
      actor_kind: ['anonymous', 'account', 'person', 'professional', 'worker', 'support'],
      person_status: ['active', 'closed'],
    },
  },
} as const
