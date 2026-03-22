export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:          '#060910',
        surface:     '#0a0d14',
        card:        '#0f1318',
        'card-hi':   '#141924',
        inset:       '#080b10',
        border:      '#1b2131',
        'border-hi': '#252d42',
        text:        '#e2e8f5',
        'text-2':    '#8896b3',
        muted:       '#4a5568',
        accent:      '#3b82f6',
        'green-t':   '#4ade80',
        'red-t':     '#f87171',
        'yellow-t':  '#facc15',
        'blue-t':    '#60a5fa',
        'orange-t':  '#fb923c',
        'gray-t':    '#94a3b8',
      },
      fontFamily: {
        sans: ['DM Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '5px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
    },
  },
  plugins: [],
};
