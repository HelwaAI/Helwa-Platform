"use client";

import { LogIn, Sparkles } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
  const handleLogin = () => {
    // Redirect to Azure Easy Auth login endpoint
    window.location.href = "/.auth/login/aad?post_login_redirect_uri=/dashboard";
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background relative overflow-hidden">
      {/* Subtle grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>

      <div className="max-w-md w-full relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center space-x-2 group">
            <div className="w-12 h-12 bg-gradient-to-br from-accent to-accent-dark rounded flex items-center justify-center group-hover:scale-110 transition-transform">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <span className="text-3xl font-semibold tracking-tight text-primary">
              Helwa<span className="text-accent">.ai</span>
            </span>
          </Link>
          <h1 className="text-3xl font-bold mt-6 mb-2 text-primary">Welcome Back</h1>
          <p className="text-secondary">Sign in to your trading platform</p>
        </div>

        {/* Login Card */}
        <div className="bg-panel border border-border rounded-lg p-8">
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-all"
          >
            <LogIn className="h-5 w-5" />
            Sign In with Microsoft
          </button>

          <div className="mt-6 text-center">
            <p className="text-secondary text-sm">
              Don't have an account?{" "}
              <Link href="/signup" className="text-accent hover:text-accent-light font-medium transition-colors">
                Sign up
              </Link>
            </p>
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-secondary">
          By continuing, you agree to Helwa.ai's{" "}
          <Link href="/terms" className="text-accent hover:text-accent-light transition-colors">Terms of Service</Link>
          {" "}and{" "}
          <Link href="/privacy" className="text-accent hover:text-accent-light transition-colors">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
