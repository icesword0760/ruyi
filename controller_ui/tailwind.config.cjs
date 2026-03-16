/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        glass: "0 20px 60px rgba(2, 6, 23, 0.10)",
      },
    },
  },
  plugins: [],
};

