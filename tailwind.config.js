/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}", // <--- Esta linha é CRUCIAL
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          light: '#00c4b8',
          DEFAULT: '#00A79D',
          dark: '#008075',
        },
        accent: {
          DEFAULT: '#FF7F50',
          dark: '#FF6347',
        },
        dark: '#1f2937',
        light: '#f9fafb',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}