import sys
fname = sys.argv[1]
kws = sys.argv[2:]
with open(fname, encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if any(kw in line for kw in kws):
            print(f"{i}: {line}", end='')
