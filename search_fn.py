import sys
path = sys.argv[1]
kw = sys.argv[2].lower()
with open(path, encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if kw in line.lower():
            print(f"{i}: {line}", end='')
