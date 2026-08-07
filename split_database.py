import sys, os
sys.stdout.reconfigure(encoding='utf-8')

SRC = '/PROJECT/vaultbase/manager-work/src-tauri/src/database.rs'
DST = '/PROJECT/vaultbase/manager-work/src-tauri/src/database'

with open(SRC, encoding='utf-8') as f:
    RAW = f.readlines()

N = len(RAW)
print(f"Total lines: {N}")

def L(a, b):
    """1-based inclusive slice."""
    return ''.join(RAW[a-1:b])

os.makedirs(DST, exist_ok=True)

def write(name, content):
    path = os.path.join(DST, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    lines = content.count('\n')
    print(f"  {name:25s}  {lines} lines")

# ═══════════════════════════════════════════════════════════════════════════
# Sub-files: just the raw method bodies (no impl wrapper)
# All will be include!()'d inside a single impl Database { ... } in mod.rs
# ═══════════════════════════════════════════════════════════════════════════

# Core: escape_like, open, pool, encryption, config, log_event, hmac_key (lines 35-177)
write('_core.rs',       L(35, 177))

# Cards: insert_cards → reencrypt_all (lines 182-865)
write('_cards.rs',      L(182, 865))

# Analytics: get_dashboard_stats → get_sidebar_badges (lines 871-1386)
write('_analytics.rs',  L(871, 1386))

# IMAP/smtp/footprints/search (lines 1535-2212: content of 2nd impl block)
write('_imap.rs',       L(1535, 2212))

# Profiles/drops/email_pool/proxies (lines 2219-2929: content of 3rd impl block part 1)
write('_profiles.rs',   L(2219, 2929))

# Shops/catalog (lines 2931-3309: content of 3rd impl block part 2)
write('_shops.rs',      L(2931, 3309))

# Orders/backup (lines 3311-3718: content of 3rd impl block part 3)
write('_orders.rs',     L(3311, 3718))

# Misc: card_shop_usage, email_footprint_stats, shop_risk, card_timeline,
#        batch_orders, proxy_shop_bindings, shop_helpers, automation, burned_cards
#        (lines 3720-4617: content of 3rd impl block part 4)
write('_misc.rs',       L(3720, 4617))

# Users/auth/sessions (lines 4624-5093: content of 4th impl block)
write('_users.rs',      L(4624, 5093))

# Free functions: fetch_bin_info + period helpers (lines 1390-1533)
write('_helpers.rs',    L(1390, 1533))

# Free functions: create_backup + mask_name + init_db + all migrations (lines 5096-N)
write('_migrations.rs', L(5096, N))

# ═══════════════════════════════════════════════════════════════════════════
# mod.rs  — the new "database.rs"
# ═══════════════════════════════════════════════════════════════════════════
mod_rs = (
    L(1, 17) +           # doc comment, #![allow(...)], use statements
    '\n' +
    L(18, 31) +          # CURRENT_MIGRATION_VERSION + struct Database
    '\n' +
    # ONE big impl block that includes all method sections
    'impl Database {\n' +
    '    include!("_core.rs");\n' +
    '    include!("_cards.rs");\n' +
    '    include!("_analytics.rs");\n' +
    '    include!("_imap.rs");\n' +
    '    include!("_profiles.rs");\n' +
    '    include!("_shops.rs");\n' +
    '    include!("_orders.rs");\n' +
    '    include!("_misc.rs");\n' +
    '    include!("_users.rs");\n' +
    '}\n\n' +
    # Free functions (not inside impl)
    'include!("_helpers.rs");\n' +
    'include!("_migrations.rs");\n'
)

write('mod.rs', mod_rs)
print(f"\nAll files written to: {DST}")
print("Next: delete src-tauri/src/database.rs so Rust uses database/ directory")
