import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "./env";

let cachedClient: SupabaseClient | undefined;

export function getSupabaseAdminClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const env = getEnv();
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to create Supabase admin client.");
  }

  cachedClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return cachedClient;
}

export function resetSupabaseAdminClientForTests(): void {
  cachedClient = undefined;
}
