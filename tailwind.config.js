/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          light: '#5A9A8F',
          DEFAULT: '#1D5C54',
          dark: '#14423C',
          legacy: '#00A79D',
        },
        sage: {
          50: '#F3F7F4',
          100: '#E4EDE7',
          200: '#C8DACF',
          300: '#A5C1B0',
          500: '#658874',
          700: '#3D5E4C',
        },
        cream: {
          DEFAULT: '#FAF7F2',
          soft: '#F5EFE6',
        },
        sand: {
          DEFAULT: '#EFE8DC',
          dark: '#DFD4C2',
        },
        terracotta: {
          soft: '#F6E6DF',
          DEFAULT: '#C4684B',
          dark: '#A35036',
        },
        earth: {
          DEFAULT: '#2F2A26',
          body: '#4F4842',
          muted: '#6B635B',
        },
        accent: {
          DEFAULT: '#C4684B',
          dark: '#A35036',
        },
        dark: '#2F2A26',
        light: '#FAF7F2',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
      },
      borderRadius: {
        organic: '2rem',
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgba(29, 92, 84, 0.10)',
        card: '0 18px 40px -20px rgba(47, 42, 38, 0.14)',
      },
    },
  },
  plugins: [],
};