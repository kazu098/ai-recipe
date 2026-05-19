import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#357A56",
        "primary-dark": "#2C6E49",
        surface: "#F5FAF7",
        accent: "#FF6B35",
      },
    },
  },
  plugins: [],
};

export default config;
