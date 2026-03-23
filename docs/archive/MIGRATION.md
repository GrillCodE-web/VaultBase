# Migration Guide — Cyber-Financial Terminal Redesign

## 📋 Pre-Migration Checklist

- [ ] Backup current codebase
- [ ] Review REDESIGN.md documentation
- [ ] Test design-demo.html in browser
- [ ] Identify custom components that need updates
- [ ] Plan rollout strategy (full vs gradual)

---

## 🚀 Quick Start (5 minutes)

### Step 1: Update Main CSS Import

**File:** `src/index.css`

```css
/* BEFORE */
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
@import './styles/tokens.css';
@import './styles/reset.css';
/* ... other imports */

/* AFTER */
@import './styles/index-redesign.css';
```

That's it! The new design system is now active.

### Step 2: Verify in Browser

1. Start dev server: `npm run dev`
2. Open http://localhost:5173
3. Check that fonts load (Rajdhani, Manrope, JetBrains Mono)
4. Verify colors match the new palette (cyan accents)

### Step 3: Test Key Pages

- [ ] Dashboard — stats cards, charts
- [ ] Cards — table, filters, actions
- [ ] Settings — forms, toggles
- [ ] Login — auth screens

---

## 🔄 Gradual Migration (Recommended)

### Phase 1: Core System (Week 1)

**Goal:** Replace design tokens and base styles

1. **Keep both style systems:**

   ```css
   /* src/index.css */
   @import './styles/tokens.css'; /* Old */
   @import './styles/index-redesign.css'; /* New (overrides) */
   ```

2. **Test in isolation:**
   - Create a new route `/redesign-preview`
   - Apply new styles only to this route
   - Compare side-by-side

3. **Update tokens gradually:**
   ```css
   /* Override specific tokens */
   :root {
     --accent: var(--accent-redesign, #3b82f6); /* Fallback to old */
   }
   ```

### Phase 2: Components (Week 2)

**Goal:** Migrate individual components

**Priority Order:**

1. Buttons (highest usage)
2. Forms (inputs, selects)
3. Badges & Status
4. Modals & Overlays
5. Tables
6. Panels

**Migration Pattern:**

```jsx
// BEFORE
<button className="btn btn-p">Save</button>

// AFTER
<button className="btn btn-accent">Save</button>
```

**Component Mapping:**

| Old Class          | New Class        | Notes                   |
| ------------------ | ---------------- | ----------------------- |
| `btn-p`            | `btn-accent`     | Purple → Cyan accent    |
| `.sc.cp`           | `.sc.cp2`        | Stat card purple → cyan |
| `text-blue-t`      | `text-accent`    | Semantic naming         |
| `.icon-btn-purple` | `.icon-btn-cyan` | New color               |

### Phase 3: Pages (Week 3)

**Goal:** Update page-specific styles

**Dashboard:**

```jsx
// Update stat cards
<div className="sc cg">  {/* Green stays */}
<div className="sc cb2"> {/* Blue stays */}
<div className="sc cp2"> {/* Purple → Cyan accent */}
```

**Cards Page:**

```jsx
// Add stagger animation
<div className="cards-grid">
  {cards.map((card, i) => (
    <div key={i} className="sc cg stagger-item">
      {/* ... */}
    </div>
  ))}
</div>
```

**Forms:**

```jsx
// Update form elements
<input className="input" />      {/* Same */}
<select className="select" />    {/* Same */}
<input type="checkbox" className="checkbox" /> {/* Enhanced */}
```

### Phase 4: Polish (Week 4)

**Goal:** Add new features and effects

1. **Enable animations:**

   ```jsx
   // Add to page wrapper
   <div className="content-main">{/* Content animates on mount */}</div>
   ```

2. **Add glow effects:**

   ```jsx
   <button className="btn btn-accent glow-pulse">Live Status</button>
   ```

3. **Enable noise/scanline:**
   ```jsx
   // In App.jsx or layout
   <div className="noise-overlay"></div>
   <div className="scanline-overlay"></div>
   ```

---

## 🎨 Component Updates

### Buttons

```jsx
// OLD STYLE
<button className="btn btn-p">Primary</button>
<button className="btn btn-b">Blue</button>
<button className="btn btn-ghost">Cancel</button>

// NEW STYLE (same classes, enhanced visuals)
<button className="btn btn-accent">Primary</button>  // Cyan gradient
<button className="btn btn-b">Blue</button>          // Enhanced
<button className="btn btn-ghost">Cancel</button>    // Enhanced hover
```

### Badges

```jsx
// OLD STYLE
<span className="badge badge-success">Active</span>

// NEW STYLE (same classes, enhanced visuals)
<span className="badge badge-success">Active</span>  // Enhanced glow
<span className="badge badge-accent">New</span>      // Cyan accent
```

### Status Indicators

```jsx
// OLD STYLE
<span style={{ color: 'green' }}>●</span> Active

// NEW STYLE
<span className="status-dot active"></span> Active
```

### Forms

```jsx
// OLD STYLE
<input type="text" className="input" />

// NEW STYLE (same class, enhanced focus states)
<input type="text" className="input" />  // Cyan focus ring

// NEW: Toggle switches
<label className="toggle-wrapper">
  <input type="checkbox" className="toggle" />
  <span className="toggle-label">Enable feature</span>
</label>
```

### Modals

```jsx
// OLD STYLE
<div className="modal-overlay">
  <div className="modal">
    <div className="modal-title">Title</div>
    {/* ... */}
  </div>
</div>

// NEW STYLE (enhanced with gradient border)
<div className="modal-overlay">  {/* Blur backdrop */}
  <div className="modal">        {/* Gradient top border */}
    <div className="modal-title">
      <span>Title</span>
      <button className="modal-close">×</button>
    </div>
    {/* ... */}
  </div>
</div>
```

---

## 🔧 Customization

### Change Accent Color

```css
/* src/styles/tokens-redesign.css */
:root {
  --accent: #00d9ff; /* Your color */
  --accent-bright: #14f195; /* Lighter variant */
  --accent-dim: rgba(0, 217, 255, 0.08);
  --accent-border: rgba(0, 217, 255, 0.25);
}
```

### Disable Effects

```css
/* src/styles/tokens-redesign.css */
:root {
  --noise-opacity: 0; /* No noise texture */
  --scanline-opacity: 0; /* No scanline */
}
```

### Adjust Animations

```css
/* src/styles/animations-redesign.css */
:root {
  --t-fast: 100ms; /* Faster transitions */
  --t-mid: 180ms;
  --t-slow: 300ms;
}
```

---

## 🐛 Common Issues

### Issue: Styles not applying

**Solution:**

1. Clear browser cache (Cmd+Shift+R)
2. Check import order in `index.css`
3. Verify file paths are correct
4. Check browser console for 404 errors

### Issue: Fonts not loading

**Solution:**

```css
/* Verify Google Fonts import in index-redesign.css */
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
```

### Issue: Colors look wrong

**Solution:**

1. Check if Tailwind is overriding CSS variables
2. Verify `:root` selector in tokens-redesign.css
3. Use browser DevTools to inspect computed styles

### Issue: Animations laggy

**Solution:**

```css
/* Reduce animation complexity */
:root {
  --noise-opacity: 0;
  --scanline-opacity: 0;
}

/* Or disable stagger animations */
.stagger-item {
  animation: none !important;
}
```

---

## 📊 Testing Checklist

### Visual Testing

- [ ] All buttons render correctly
- [ ] Forms have proper focus states
- [ ] Modals have backdrop blur
- [ ] Tables have hover effects
- [ ] Badges have correct colors
- [ ] Stat cards have gradient borders
- [ ] Sidebar has accent indicators
- [ ] Topbar tabs have gradient underline

### Functional Testing

- [ ] All interactive elements clickable
- [ ] Forms submit correctly
- [ ] Modals open/close
- [ ] Filters work
- [ ] Search functions
- [ ] Bulk actions trigger
- [ ] Tooltips appear on hover

### Browser Testing

- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

### Performance Testing

- [ ] Page load < 2s
- [ ] Animations smooth (60fps)
- [ ] No layout shifts
- [ ] CSS bundle < 50KB
- [ ] Fonts load quickly

---

## 🚢 Deployment

### Pre-Deploy

1. **Build production:**

   ```bash
   npm run build
   ```

2. **Test production build:**

   ```bash
   npm run preview
   ```

3. **Check bundle size:**
   ```bash
   ls -lh dist/assets/*.css
   ```

### Deploy

1. **Commit changes:**

   ```bash
   git add src/styles/*redesign.css
   git commit -m "feat: implement Cyber-Financial Terminal redesign"
   ```

2. **Deploy to staging:**

   ```bash
   # Your deploy command
   ```

3. **Monitor for issues:**
   - Check error logs
   - Monitor user feedback
   - Watch performance metrics

### Rollback Plan

If issues arise:

```bash
# Quick rollback
git revert HEAD
git push

# Or restore old styles
# In src/index.css, comment out:
# @import './styles/index-redesign.css';
```

---

## 📈 Success Metrics

Track these metrics post-deployment:

- **User Engagement:** Time on page, clicks
- **Performance:** Page load time, FPS
- **Feedback:** User surveys, support tickets
- **Conversion:** Task completion rates

---

## 🎓 Training Materials

### For Developers

- Review `REDESIGN.md` documentation
- Study `RedesignExamples.jsx` components
- Test `design-demo.html` locally
- Read inline CSS comments

### For Designers

- Review color palette in `tokens-redesign.css`
- Check typography system (Rajdhani, Manrope, JetBrains Mono)
- Explore `design-demo.html` for all components
- Test responsive breakpoints

---

## 🤝 Support

**Questions?**

- Check `REDESIGN.md` for detailed docs
- Review `design-demo.html` for examples
- Inspect `RedesignExamples.jsx` for React patterns

**Issues?**

- Check browser console for errors
- Verify file paths and imports
- Test in incognito mode (no extensions)
- Clear cache and rebuild

---

**Migration complete! 🎉**

Your CC Manager now has a professional Cyber-Financial Terminal aesthetic.
