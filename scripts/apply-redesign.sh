#!/bin/bash
# ═══════════════════════════════════════════════════════════
# CC Manager — Redesign Integration Script
# Quick setup script for applying the Cyber-Financial Terminal redesign
# ═══════════════════════════════════════════════════════════

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  CC Manager — Cyber-Financial Terminal Redesign"
echo "  Integration Script"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found. Please run this script from the project root.${NC}"
    exit 1
fi

if [ ! -d "src/styles" ]; then
    echo -e "${RED}Error: src/styles directory not found.${NC}"
    exit 1
fi

# Function to backup current styles
backup_styles() {
    echo -e "${BLUE}→ Creating backup of current styles...${NC}"
    BACKUP_DIR="src/styles/backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"

    # Backup main index.css
    if [ -f "src/index.css" ]; then
        cp "src/index.css" "$BACKUP_DIR/index.css.backup"
        echo -e "${GREEN}✓ Backed up index.css${NC}"
    fi

    echo -e "${GREEN}✓ Backup created at: $BACKUP_DIR${NC}"
    echo ""
}

# Function to apply redesign
apply_redesign() {
    echo -e "${BLUE}→ Applying Cyber-Financial Terminal redesign...${NC}"

    # Check if redesign files exist
    if [ ! -f "src/styles/index-redesign.css" ]; then
        echo -e "${RED}Error: Redesign files not found. Please ensure all *-redesign.css files are present.${NC}"
        exit 1
    fi

    # Update index.css
    cat > src/index.css << 'EOF'
/* ═══════════════════════════════════════════════════════════
   CC MANAGER — CYBER-FINANCIAL TERMINAL
   Main stylesheet with redesigned components
   ═══════════════════════════════════════════════════════════ */

@import './styles/index-redesign.css';
EOF

    echo -e "${GREEN}✓ Updated src/index.css${NC}"
    echo ""
}

# Function to verify installation
verify_installation() {
    echo -e "${BLUE}→ Verifying installation...${NC}"

    local errors=0

    # Check for required files
    required_files=(
        "src/styles/index-redesign.css"
        "src/styles/tokens-redesign.css"
        "src/styles/animations-redesign.css"
        "src/styles/reset-redesign.css"
    )

    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            echo -e "${GREEN}✓ Found: $file${NC}"
        else
            echo -e "${RED}✗ Missing: $file${NC}"
            errors=$((errors + 1))
        fi
    done

    echo ""

    if [ $errors -eq 0 ]; then
        echo -e "${GREEN}✓ All required files present${NC}"
        return 0
    else
        echo -e "${RED}✗ Missing $errors required file(s)${NC}"
        return 1
    fi
}

# Function to show next steps
show_next_steps() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo -e "${GREEN}✓ Redesign Applied Successfully!${NC}"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Start the development server:"
    echo -e "   ${YELLOW}npm run dev${NC}"
    echo ""
    echo "2. Open the demo page:"
    echo -e "   ${YELLOW}open design-demo.html${NC}"
    echo ""
    echo "3. Review documentation:"
    echo -e "   ${YELLOW}cat REDESIGN.md${NC}"
    echo -e "   ${YELLOW}cat MIGRATION.md${NC}"
    echo ""
    echo "4. Test the application and verify:"
    echo "   - Fonts load correctly (Rajdhani, Manrope, JetBrains Mono)"
    echo "   - Colors match the new palette (cyan accents)"
    echo "   - Animations work smoothly"
    echo "   - All pages render correctly"
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo ""
}

# Function to rollback
rollback() {
    echo -e "${YELLOW}→ Rolling back to previous styles...${NC}"

    # Find most recent backup
    LATEST_BACKUP=$(ls -td src/styles/backup-* 2>/dev/null | head -1)

    if [ -z "$LATEST_BACKUP" ]; then
        echo -e "${RED}Error: No backup found.${NC}"
        exit 1
    fi

    if [ -f "$LATEST_BACKUP/index.css.backup" ]; then
        cp "$LATEST_BACKUP/index.css.backup" "src/index.css"
        echo -e "${GREEN}✓ Restored index.css from backup${NC}"
    fi

    echo -e "${GREEN}✓ Rollback complete${NC}"
    echo ""
}

# Main menu
show_menu() {
    echo "What would you like to do?"
    echo ""
    echo "1) Apply redesign (with backup)"
    echo "2) Apply redesign (without backup)"
    echo "3) Rollback to previous styles"
    echo "4) Verify installation"
    echo "5) Exit"
    echo ""
    read -p "Enter your choice [1-5]: " choice

    case $choice in
        1)
            backup_styles
            apply_redesign
            verify_installation
            show_next_steps
            ;;
        2)
            apply_redesign
            verify_installation
            show_next_steps
            ;;
        3)
            rollback
            ;;
        4)
            verify_installation
            ;;
        5)
            echo "Exiting..."
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid choice. Please try again.${NC}"
            echo ""
            show_menu
            ;;
    esac
}

# Run main menu
show_menu
