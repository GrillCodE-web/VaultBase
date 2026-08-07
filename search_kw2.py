import sys
path = sys.argv[1]
keywords = sys.argv[2:]
with open(path, encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if any(k.lower() in line.lower() for k in keywords):
            sys.stdout.buffer.write(f"{i}: {line}".encode('utf-8', errors='replace'))
