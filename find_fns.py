lines = open('C:/PROJECT/vaultbase/manager-work/src-tauri/src/main.rs', encoding='utf-8').readlines()
for i, l in enumerate(lines, 1):
    s = l.rstrip()
    if 'fn get_cards' in s or 'fn import_cards' in s or 'fn reveal_card' in s or 'fn get_card' in s:
        print(i, s)
