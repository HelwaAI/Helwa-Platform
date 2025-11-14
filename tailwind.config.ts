import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Honey-inspired dark theme
        background: "#0A0806", // Deep dark brown (dark honey)
        panel: "#1A1410", // Dark chocolate
        elevated: "#251C15", // Warm dark brown
        border: "#3D2F1F", // Amber-tinted border
        primary: "#FFF8E7", // Cream text
        secondary: "#E8D5B5", // Light honey gold
        accent: "#F59E0B", // Vibrant amber/gold
        "accent-dark": "#D97706", // Darker gold
        "accent-light": "#FCD34D", // Light honey yellow
        success: "#10B981", // Emerald green
        warning: "#F59E0B",
        honey: {
          50: "#FFFBEB",
          100: "#FEF3C7",
          200: "#FDE68A",
          300: "#FCD34D",
          400: "#FBBF24",
          500: "#F59E0B",
          600: "#D97706",
          700: "#B45309",
          800: "#92400E",
          900: "#78350F",
        },
      },
      backgroundImage: {
        'honey-gradient': 'linear-gradient(135deg, #F59E0B 0%, #D97706 50%, #B45309 100%)',
        'honey-radial': 'radial-gradient(circle at 50% 50%, #F59E0B, #D97706)',
        'gradient-radial': 'radial-gradient(circle, var(--tw-gradient-stops))',
        'honeycomb': "url(\"data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23F59E0B' fill-opacity='0.03' fill-rule='evenodd'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/svg%3E\")",
      },
      boxShadow: {
        'honey': '0 4px 20px rgba(245, 158, 11, 0.3)',
        'honey-lg': '0 10px 40px rgba(245, 158, 11, 0.4)',
        'honey-xl': '0 20px 60px rgba(245, 158, 11, 0.5)',
      },
      animation: {
        'honey-drip': 'honeyDrip 3s ease-in-out infinite',
        'honeycomb-pulse': 'honeycombPulse 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        honeyDrip: {
          '0%, 100%': { transform: 'translateY(0px)', opacity: '1' },
          '50%': { transform: 'translateY(10px)', opacity: '0.8' },
        },
        honeycombPulse: {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '0.6' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
