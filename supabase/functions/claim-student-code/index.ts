import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value.normalize("NFKC").trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) return json({ error: "Sesión no válida." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Configuración del servidor incompleta." }, 500);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Sesión no válida." }, 401);

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Solicitud no válida." }, 400);
  }

  if (typeof body.code !== "string" || body.code.trim().length < 8 || body.code.trim().length > 128) {
    return json({ error: "Introduce un código válido." }, 400);
  }

  const codeHash = await sha256Hex(body.code);
  const { data: courseId, error } = await admin.rpc("claim_student_code_atomic", { p_user_id: authData.user.id, p_hash: codeHash });
  if (error) return json({ error: "No se ha podido activar el acceso. Comprueba el código o cierra la sesión anterior." }, 409);
  return json({ ok: true, course_id: courseId });
});