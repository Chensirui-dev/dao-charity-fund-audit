/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: '#0A0A0A',
        card: '#141414',
        'card-hover': '#1A1A1A',
        gold: '#D4A853',
        'gold-dark': '#C8963E',
        'gold-light': '#E5C97A',
        muted: '#8B8B8B',
        line: '#2A2A2A',
        'line-gold': '#3D3220',
      },
      boxShadow: {
        gold: '0 0 20px rgba(212,168,83,0.3)',
        'gold-strong': '0 0 28px rgba(212,168,83,0.45)',
        emerald: '0 0 12px rgba(16,185,129,0.4)',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-500px 0' },
          '100%': { backgroundPosition: '500px 0' },
        },
      },
      animation: {
        slideIn: 'slideIn 420ms ease-out both',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [],
};
