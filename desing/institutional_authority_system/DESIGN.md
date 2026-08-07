---
name: Institutional Authority System
colors:
  surface: '#f8f9ff'
  surface-dim: '#ccdbf4'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d4e4fc'
  on-surface: '#0d1c2e'
  on-surface-variant: '#43474e'
  inverse-surface: '#223144'
  inverse-on-surface: '#eaf1ff'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#455f88'
  primary: '#002045'
  on-primary: '#ffffff'
  primary-container: '#1a365d'
  on-primary-container: '#86a0cd'
  inverse-primary: '#adc7f7'
  secondary: '#7d5700'
  on-secondary: '#ffffff'
  secondary-container: '#ffc250'
  on-secondary-container: '#725000'
  tertiary: '#321b00'
  on-tertiary: '#ffffff'
  tertiary-container: '#4f2e00'
  on-tertiary-container: '#c6955e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#adc7f7'
  on-primary-fixed: '#001b3c'
  on-primary-fixed-variant: '#2d476f'
  secondary-fixed: '#ffdeaa'
  secondary-fixed-dim: '#f8bc4b'
  on-secondary-fixed: '#271900'
  on-secondary-fixed-variant: '#5f4100'
  tertiary-fixed: '#ffddba'
  tertiary-fixed-dim: '#f2bc82'
  on-tertiary-fixed: '#2b1700'
  on-tertiary-fixed-variant: '#633f0f'
  background: '#f8f9ff'
  on-background: '#0d1c2e'
  surface-variant: '#d4e4fc'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

The design system is engineered to project stability, transparency, and official capacity. The target audience includes citizens and administrative clerks who require a high-efficiency interface that minimizes cognitive load while maintaining a sense of formal gravity. 

The aesthetic is **Modern Corporate/Institutional**, characterized by a rigorous adherence to hierarchy, structured layouts, and a "function-over-form" philosophy. It utilizes ample whitespace to ensure clarity in complex data reporting, avoiding any decorative elements that do not serve a specific navigational or informational purpose. The emotional response should be one of confidence and reliability, ensuring users feel their data is handled with precision and legal integrity.

## Colors

The palette is anchored by a deep institutional blue, used for primary actions and structural headers to establish authority. The secondary amber is used sparingly for accents, highlights, and secondary calls to action, drawing inspiration from regional heraldry.

- **Surface Levels:** Use pure white (`#ffffff`) for cards and input areas, and the subtle gray (`#f7fafc`) for page backgrounds to provide a soft contrast.
- **Status Indicators:** High-contrast semantic colors are used for fine statuses (Paid, Pending, Overdue). These colors must always be accompanied by clear text labels or icons to ensure accessibility for colorblind users.
- **Text:** Use a dark navy or charcoal for primary text to ensure high contrast ratios against the white background.

## Typography

This design system uses **Inter** exclusively to ensure maximum legibility across digital displays. The type scale is strictly hierarchical. 

- **Headlines:** Use semi-bold or bold weights to anchor page sections. 
- **Body Text:** Maintained at 16px for general readability, dropping to 14px for dense data tables and sidebars.
- **Data Labels:** Use the `label-caps` style for table headers and form labels to differentiate them clearly from user-inputted data.
- **Line Heights:** Generous line heights are employed to prevent "text crowding" in long legal descriptions or fine details.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy for desktop to maintain alignment and readability of complex reports, while transitioning to a fluid stack for mobile.

- **Desktop (1440px+):** 12-column grid with a max-width container of 1280px. Gutters are fixed at 24px.
- **Sidebar:** A persistent 280px sidebar for navigation on desktop, collapsing into a bottom-bar or hamburger menu on mobile.
- **KPI Dashboards:** Elements should span 3 or 4 columns, allowing for 3-4 key metrics to be displayed side-by-side.
- **Rhythm:** Use an 8px base grid for all component-level spacing (padding, margins between buttons).

## Elevation & Depth

Visual hierarchy is established through **Tonal Layering** and **Low-Contrast Outlines**.

- **Level 0 (Background):** `#f7fafc`.
- **Level 1 (Cards/Content):** Pure white with a 1px border of `#e2e8f0`.
- **Level 2 (Interactive/Floating):** Use a very soft, large-radius ambient shadow (`0 4px 12px rgba(0,0,0,0.05)`) to indicate depth on hover or for dropdown menus.
- **Depth Philosophy:** Avoid heavy shadows. Depth is primarily signaled by the contrast between the light gray background and white containers. Borders should be crisp and consistently 1px.

## Shapes

The design system utilizes **Soft** roundedness (`0.25rem` or `4px`). This provides a professional, modern look that is less aggressive than sharp corners but more formal than highly rounded or "bubbly" UI styles.

- **Buttons & Inputs:** 4px border radius.
- **Cards & Modals:** 8px (`rounded-lg`) border radius.
- **Data Tags/Chips:** May use a fully pill-shaped radius for distinct visual categorization within tables.

## Components

### Data Tables
Tables are the core of this system. They should feature:
- `label-caps` for headers with a light gray background.
- Alternating row zebra-striping is discouraged; use subtle 1px dividers instead.
- High-contrast status badges for "Paid" (Green), "Pending" (Amber), and "Overdue" (Red).

### Buttons
- **Primary:** Deep institutional blue with white text.
- **Secondary:** Transparent background with the blue border and text.
- **Warning/Action:** The gold/amber color is used only for specific "Attention Required" actions.

### Input Fields
- Fields must have a clear 1px border. On focus, the border thickens to 2px in the primary blue. 
- Error states must use the status-danger red for both the border and a helper text message below the field.

### KPI Cards
- Large numeric values in `display-lg`.
- Small trend indicators (up/down arrows) in semantic colors.
- Icons should be monochromatic (primary blue) and housed in a light blue circular background.

### Navigation Sidebar
- High-contrast background (either very dark navy or very light gray).
- Active states indicated by a 4px vertical bar on the left edge in the secondary amber color.