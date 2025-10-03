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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      backdrop_library: {
        Row: {
          cloudinary_public_id: string | null
          created_at: string
          dimensions: Json | null
          file_size: number | null
          floor_y_px: number | null
          id: string
          name: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cloudinary_public_id?: string | null
          created_at?: string
          dimensions?: Json | null
          file_size?: number | null
          floor_y_px?: number | null
          id?: string
          name: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cloudinary_public_id?: string | null
          created_at?: string
          dimensions?: Json | null
          file_size?: number | null
          floor_y_px?: number | null
          id?: string
          name?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      batch_images: {
        Row: {
          batch_id: string
          cloudinary_public_id: string | null
          cloudinary_version: number | null
          created_at: string
          dimensions: Json
          file_size: number
          height: number | null
          id: string
          image_type: string
          name: string
          render_params: Json | null
          sort_order: number
          storage_path: string
          type: string | null
          width: number | null
        }
        Insert: {
          batch_id: string
          cloudinary_public_id?: string | null
          cloudinary_version?: number | null
          created_at?: string
          dimensions: Json
          file_size: number
          height?: number | null
          id?: string
          image_type: string
          name: string
          render_params?: Json | null
          sort_order: number
          storage_path: string
          type?: string | null
          width?: number | null
        }
        Update: {
          batch_id?: string
          cloudinary_public_id?: string | null
          cloudinary_version?: number | null
          created_at?: string
          dimensions?: Json
          file_size?: number
          height?: number | null
          id?: string
          image_type?: string
          name?: string
          render_params?: Json | null
          sort_order?: number
          storage_path?: string
          type?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_images_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "project_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_cache: {
        Row: {
          cache_key: string
          created_at: string | null
          expires_at: string | null
          hit_count: number | null
          id: string
          last_accessed: string | null
          operation: Database["public"]["Enums"]["operation_type"]
          options_hash: string
          original_url: string
          processed_url: string
        }
        Insert: {
          cache_key: string
          created_at?: string | null
          expires_at?: string | null
          hit_count?: number | null
          id?: string
          last_accessed?: string | null
          operation: Database["public"]["Enums"]["operation_type"]
          options_hash: string
          original_url: string
          processed_url: string
        }
        Update: {
          cache_key?: string
          created_at?: string | null
          expires_at?: string | null
          hit_count?: number | null
          id?: string
          last_accessed?: string | null
          operation?: Database["public"]["Enums"]["operation_type"]
          options_hash?: string
          original_url?: string
          processed_url?: string
        }
        Relationships: []
      }
      project_batches: {
        Row: {
          created_at: string
          id: string
          name: string
          thumbnail_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      system_health: {
        Row: {
          id: string
          metadata: Json | null
          metric_name: string
          metric_value: number
          recorded_at: string | null
        }
        Insert: {
          id?: string
          metadata?: Json | null
          metric_name: string
          metric_value: number
          recorded_at?: string | null
        }
        Update: {
          id?: string
          metadata?: Json | null
          metric_name?: string
          metric_value?: number
          recorded_at?: string | null
        }
        Relationships: []
      }
      user_quotas: {
        Row: {
          created_at: string | null
          current_usage: number | null
          id: string
          monthly_limit: number | null
          reset_date: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_usage?: number | null
          id?: string
          monthly_limit?: number | null
          reset_date?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_usage?: number | null
          id?: string
          monthly_limit?: number | null
          reset_date?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_data: {
        Args: Record<PropertyKey, never>
        Returns: {
          cache_deleted: number
          jobs_deleted: number
        }[]
      }
      get_cache_entry: {
        Args: {
          p_operation: Database["public"]["Enums"]["operation_type"]
          p_options_hash: string
          p_original_url: string
        }
        Returns: {
          hit_count: number
          processed_url: string
        }[]
      }
      reset_monthly_quotas: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      update_user_quota_usage: {
        Args: { increment?: number; user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      operation_type:
        | "upscale"
        | "compress"
        | "thumbnail"
        | "format_convert"
        | "batch"
        | "composite"
      processing_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "cancelled"
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
      operation_type: [
        "upscale",
        "compress",
        "thumbnail",
        "format_convert",
        "batch",
        "composite",
      ],
      processing_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "cancelled",
      ],
    },
  },
} as const
