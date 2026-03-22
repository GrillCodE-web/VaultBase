# CC Manager Design System

## Overview
Cyber-Financial Terminal aesthetic with cyan/teal primary accent and electric purple secondary.

## Color Palette

### Base Colors
```css
--bg:        #0d1117  /* Main background */
--surface:   #161b22  /* Elevated surface */
--card:      #1c2128  /* Card background */
--card-hi:   #22272e  /* Card hover state */
--inset:     #0d1117  /* Inset/depressed areas */
```

### Borders
```css
--border:    #30363d  /* Default border */
--border-hi: #444c56  /* Hover/active border */
--border-accent: rgba(0, 217, 255, 0.3)  /* Accent border */
```

### Text Hierarchy
```css
--text:      #f0f6fc  /* Primary text */
--text-2:    #c9d1d9  /* Secondary text */
--text-3:    #8b949e  /* Tertiary text */
--muted:     #6e7681  /* Muted text */
--dim:       #484f58  /* Dimmed text */
```

### Accent Colors
```css
--accent:        #00d9ff  /* Primary accent (Cyan) */
--accent-bright: #14f195  /* Bright accent */
--accent-dim:    rgba(0, 217, 255, 0.08)  /* Dim background */
--accent-border: rgba(0, 217, 255, 0.25)  /* Accent border */
--accent-text:   #58e1ff  /* Accent text */

--purple:        #a855f7  /* Secondary accent */
--purple-bright: #c084fc  /* Bright purple */
```

### Status Colors
```css
--green:   #10b981  /* Success */
--green-t: #34d399  /* Success text */
--red:     #ef4444  /* Error/Danger */
--red-t:   #f87171  /* Error text */
--yellow:  #f59e0b  /* Warning */
--yellow-t:#fbbf24  /* Warning text */
--blue:    #3b82f6  /* Info */
--blue-t:  #60a5fa  /* Info text */
--orange:  #f97316  /* Alert */
--orange-t:#fb923c  /* Alert text */
--teal:    #14b8a6  /* Neutral */
--teal-t:  #2dd4bf  /* Neutral text */
```

## Typography

### Font Families
- **Headings**: Rajdhani (400, 500, 600, 700)
- **Body**: Manrope (400, 500, 600, 700, 800)
- **Monospace**: JetBrains Mono (400, 500, 600, 700)

### Font Sizes
- **Display**: 32px (dashboard values)
- **Heading 1**: 28px
- **Heading 2**: 18px
- **Heading 3**: 16px
- **Body**: 13-14px
- **Small**: 11-12px
- **Tiny**: 10px

## Spacing System (4px grid)
```css
--sp-1:  4px
--sp-2:  8px
--sp-3: 12px
--sp-4: 16px
--sp-5: 20px
--sp-6: 24px
--sp-8: 32px
```

## Border Radius
```css
--r-sm:  4px   /* Small elements */
--r-md:  8px   /* Medium elements */
--r-lg: 12px   /* Large elements */
--r-xl: 16px   /* Extra large */
```

## Transitions
```css
--t-fast: 140ms cubic-bezier(0.4, 0, 0.2, 1)
--t-mid:  220ms cubic-bezier(0.4, 0, 0.2, 1)
--t-slow: 350ms cubic-bezier(0.4, 0, 0.2, 1)
```

## Shadows
```css
--shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3)
--shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4)
--shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5)
--shadow-glow: 0 0 24px rgba(0, 217, 255, 0.2)
```

## Component Patterns

### Status Badges
```css
.st-pending   /* Yellow - Pending state */
.st-active    /* Blue - Active state */
.st-delivered /* Green - Success state */
.st-decline   /* Red - Error state */
.st-cancelled /* Red - Cancelled state */
```

### Buttons
```css
.btn          /* Base button */
.btn-b        /* Blue primary */
.btn-g        /* Green success */
.btn-r        /* Red danger */
.btn-o        /* Orange warning */
.btn-ghost    /* Transparent */
.btn-sm       /* Small size */
.btn-icon     /* With icon */
```

### Cards
```css
.card         /* Base card */
.panel        /* Panel with header */
.info-panel   /* Info panel with icon */
.stat-panel   /* Stat display panel */
```

### Forms
```css
.form-input   /* Text input */
.form-select  /* Select dropdown */
.form-textarea /* Textarea */
.form-label   /* Form label */
.form-error   /* Error message */
```

## Usage Guidelines

### Do's ✓
- Use design tokens (CSS variables) for all colors
- Follow 4px spacing grid
- Use semantic status colors
- Apply proper hover states
- Include focus styles for accessibility
- Use appropriate font families for context

### Don'ts ✗
- Don't use hardcoded colors
- Don't mix spacing values outside the grid
- Don't skip hover/focus states
- Don't use generic fonts
- Don't create inconsistent border radius

## Responsive Breakpoints
```css
@media (max-width: 1024px) { /* Tablet */ }
@media (max-width: 768px)  { /* Mobile */ }
@media (max-width: 640px)  { /* Small mobile */ }
```

## Accessibility
- All interactive elements have focus states
- Color contrast meets WCAG AA standards
- Focus outline: 2px solid var(--accent)
- Focus offset: 2px

## Special Effects
- Noise texture overlay (opacity: 0.015)
- Scanline animation (8s linear infinite)
- Gradient accents on hover
- Smooth transitions on all interactive elements

## File Structure
```
src/styles/
├── index-redesign.css          # Main entry point
├── tokens-redesign.css         # Design tokens
├── reset-redesign.css          # CSS reset
├── animations-redesign.css     # Animations
├── utilities-redesign.css      # Utility classes
├── layout/
│   ├── sidebar-redesign.css
│   ├── topbar-redesign.css
│   └── content-redesign.css
├── components/
│   ├── buttons-redesign.css
│   ├── forms-redesign.css
│   ├── modal-redesign.css
│   ├── table-redesign.css
│   ├── badges-redesign.css
│   ├── filters-redesign.css
│   └── panel-redesign.css
└── pages/
    ├── dashboard-redesign.css
    ├── auth-redesign.css
    ├── cards-redesign.css
    ├── profiles-redesign.css
    ├── updates-redesign.css
    ├── orders-redesign.css
    ├── shops-redesign.css
    ├── proxies-redesign.css
    ├── emails-redesign.css
    ├── imap-redesign.css
    ├── settings-redesign.css
    ├── activity-log-redesign.css
    ├── catalog-redesign.css
    └── onboarding-redesign.css
```

## Maintenance
- All CSS is modular and organized by component/page
- Use existing patterns before creating new ones
- Test responsive behavior on all breakpoints
- Verify accessibility with screen readers
- Check color contrast for new color combinations
