import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        jarvis: {
          bg: "#000000",
          surface: "#16181c",
          hover: "#1e2026",
          border: "#2f3336",
          primary: "#1d9bf0",
          light: "#8ecdf8",
          text: "#e7e9ea",
          muted: "#71767b",
          success: "#00ba7c",
          warning: "#ffd400",
          error: "#f4212e",
          thinking: "#7856ff",
          cyan: "#1d9bf0",
          aqua: "#8ecdf8",
          ice: "#e7e9ea",
          deep: "#16181c",
          ink: "#000000",
          abyss: "#050505",
          panel: "#16181c",
          glass: "rgba(255, 255, 255, 0.04)",
          glow: "#8ecdf8",
          violet: "#7856ff",
          gold: "#ffd400",
          danger: "#f4212e",
          warn: "#ffd400",
          ok: "#00ba7c",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      transitionDuration: {
        400: "400ms",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        techno: ["Space Grotesk", "Inter", "sans-serif"],
      },
      backdropBlur: {
        xs: "2px",
        "3xl": "48px",
        "4xl": "72px",
      },
      keyframes: {
        scan: {
          "0%": { transform: "translateY(-10vh)", opacity: "0" },
          "10%": { opacity: "0.6" },
          "90%": { opacity: "0.6" },
          "100%": { transform: "translateY(110vh)", opacity: "0" },
        },
        flicker: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.78" } },
        spin_slow: { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
        spin_rev: { from: { transform: "rotate(360deg)" }, to: { transform: "rotate(0deg)" } },
        pulse_glow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(0,200,255,0), 0 0 18px rgba(0,200,255,0.22)" },
          "50%": { boxShadow: "0 0 0 4px rgba(0,200,255,0.08), 0 0 28px rgba(0,200,255,0.45)" },
        },
        orb_pulse: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.55" },
          "50%": { transform: "scale(1.06)", opacity: "0.9" },
        },
        boot_in: {
          from: { opacity: "0", transform: "translateY(8px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        aurora_drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "33%": { transform: "translate3d(4%,-3%,0) scale(1.08)" },
          "66%": { transform: "translate3d(-3%,2%,0) scale(0.96)" },
        },
        shimmer: {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(220%)" },
        },
        float_y: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "zoom-in-95": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-from-top-3": {
          from: { transform: "translateY(-0.75rem)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        wave: {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
      },
      animation: {
        scan: "scan 9s cubic-bezier(0.4,0,0.2,1) infinite",
        flicker: "flicker 4s ease-in-out infinite",
        spin_slow: "spin_slow 24s linear infinite",
        spin_rev: "spin_rev 36s linear infinite",
        pulse_glow: "pulse_glow 3.5s ease-in-out infinite",
        orb_pulse: "orb_pulse 3.2s ease-in-out infinite",
        boot_in: "boot_in 0.55s cubic-bezier(0.16,1,0.3,1) both",
        aurora: "aurora_drift 22s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        float_y: "float_y 6s ease-in-out infinite",
        "fade-in": "fade-in 0.3s ease-out both",
        "zoom-in-95": "zoom-in-95 0.3s ease-out both",
        "slide-in-from-top-3": "slide-in-from-top-3 0.4s ease-out both",
        in: "fade-in 0.3s ease-out both",
        wave: "wave 1.1s ease-in-out infinite",
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(0,200,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,255,0.04) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "44px 44px",
      },
    },
  },
  plugins: [],
} satisfies Config;
