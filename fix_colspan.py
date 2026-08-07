with open('src/pages/Profiles.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Only replace colSpan={12} with colSpan={13} in this file
content = content.replace('colSpan={12}', 'colSpan={13}')

with open('src/pages/Profiles.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
