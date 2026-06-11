"""Validate the inner patch literal compiles when stripped of its
string-concatenation wrapping. Mirrors how the runtime extracts and
exec()s the patch body."""
import ast
import re

src = open('benchmark/scripts/zork-bench/zork_agent_patch.py', encoding='utf-8').read()

# Find PATCH_BODY = ( ... )
m = re.search(r'INJECTION\s*=\s*\(\s*\n(.*?)\n\)\s*\n', src, re.S)
if not m:
    print('Could not locate INJECTION block.')
    raise SystemExit(1)

block = m.group(1)
parts = re.findall(r'"((?:[^"\\]|\\.)*)"', block)
body = ''.join(p.encode().decode('unicode_escape') for p in parts)

try:
    compile(body, '<patch>', 'exec')
    print('inner patch literal compiles OK')
except SyntaxError as e:
    print(f'SYNTAX ERROR line {e.lineno}: {e.msg}')
    lines = body.splitlines()
    for i in range(max(0, e.lineno - 3), min(len(lines), e.lineno + 2)):
        marker = '>>>' if i + 1 == e.lineno else '   '
        print(f'{marker} {i + 1:4d}: {lines[i]}')
    raise SystemExit(1)
