"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { signIn } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await signIn(email, password);

    setLoading(false);

    if (authError) {
      const msg = authError.message || "Credenciales incorrectas.";
      if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials")) {
        setError("Credenciales incorrectas. Verificá tu email y contraseña.");
      } else if (msg.includes("Email not confirmed")) {
        setError("Tu email no está confirmado. Revisá tu bandeja de entrada o contactá al administrador.");
      } else if (msg.includes("user_banned") || msg.includes("User is banned")) {
        setError("Tu cuenta está desactivada. Contactá al administrador.");
      } else {
        setError(msg);
      }
      return;
    }

    router.push("/");
  }

  return (
    <div className="zentra-login-bg flex min-h-dvh w-full flex-col items-center justify-center overflow-x-hidden overflow-y-auto px-4 py-5 md:h-dvh md:overflow-y-hidden md:py-6">
      <div className="flex w-full max-w-[22rem] shrink-0 flex-col items-center gap-3 sm:max-w-sm sm:gap-4">
        <div className="w-full max-w-[13.5rem] shrink-0 sm:max-w-[15rem]">
          <Image
            src="/brand/zentra-logo-official.png"
            alt="ZENTRA"
            width={480}
            height={264}
            priority
            className="h-auto w-full max-h-[4.25rem] object-contain object-center sm:max-h-[4.75rem]"
          />
        </div>

        <p className="text-center text-sm text-sky-100/90">Iniciá sesión para continuar</p>

        <div className="w-full rounded-2xl border border-white/20 bg-white/[0.97] p-5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.38)] backdrop-blur-md sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#0F172A]">Correo electrónico</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@empresa.com"
                required
                autoFocus
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] transition-all placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#0F172A]">Contraseña</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-[#0F172A] transition-all placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={() => setShowPass(true)}
                  onMouseUp={() => setShowPass(false)}
                  onMouseLeave={() => setShowPass(false)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 transition-colors hover:text-[#0F172A]"
                  aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 sm:px-4 sm:py-3">
                <span aria-hidden>⚠</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#0EA5E9] px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-[#0284C7] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
            >
              {loading ? "Verificando…" : "Iniciar sesión"}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-sky-200/55 sm:text-xs">Acceso restringido</p>
      </div>
    </div>
  );
}
