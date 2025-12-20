/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark theme depth system colors (using CSS variables)
        "bg-darkest": "var(--bg-darkest)",
        "bg-dark": "var(--bg-dark)",
        bg: "var(--bg)",
        "bg-light": "var(--bg-light)",
        "bg-lighter": "var(--bg-lighter)",
        // Accent colors
        "accent-primary": "var(--accent-primary)",
        "accent-primary-dark": "var(--accent-primary-dark)",
        "accent-primary-light": "var(--accent-primary-light)",
        "accent-success": "var(--accent-success)",
        "accent-warning": "var(--accent-warning)",
        "accent-danger": "var(--accent-danger)",
        // Text colors
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-tertiary": "var(--text-tertiary)",
        // Border colors
        "border-subtle": "var(--border-subtle)",
        "border-strong": "var(--border-strong)",
      },
      boxShadow: {
        "depth-s": "var(--shadow-s)",
        "depth-m": "var(--shadow-m)",
        "depth-l": "var(--shadow-l)",
        "depth-inset": "var(--shadow-inset)",
        "glow-primary": "var(--glow-primary)",
        "glow-success": "var(--glow-success)",
      },
      transitionDuration: {
        fast: "150ms",
        normal: "250ms",
        slow: "350ms",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      animation: {
        fadeIn: "fadeIn 250ms ease-out",
        pulse: "pulse 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          from: {
            opacity: "0",
            transform: "translateY(10px)",
          },
          to: {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        pulse: {
          "0%, 100%": {
            opacity: "1",
          },
          "50%": {
            opacity: "0.7",
          },
        },
      },
    },
  },
  plugins: [],
};
