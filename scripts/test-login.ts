import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import * as path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function testLogin() {
  if (!url || !key) {
    console.error("Faltan variables de entorno");
    process.exit(1);
  }

  console.log("URL Supabase:", url);
  const supabase = createClient(url, key);

  const { data, error } = await supabase.auth.signInWithPassword({
    email: "neurautomations@gmail.com",
    password: "Neura2026",
  });

  if (error) {
    console.error("Error de login:", error.message);
    process.exit(1);
  }

  console.log("✓ Login exitoso. Usuario:", data.user?.email);
}

testLogin();
