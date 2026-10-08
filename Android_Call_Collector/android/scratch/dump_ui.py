import subprocess
import re

def run(cmd):
    return subprocess.run(['adb', '-s', 'SSTST8LVZPWGHEQO'] + cmd, capture_output=True, text=True).stdout.strip()

run(['shell', 'uiautomator', 'dump', '/sdcard/detail_dump.xml'])
run(['pull', '/sdcard/detail_dump.xml', 'scratch/detail_dump_live.xml'])

with open('scratch/detail_dump_live.xml', 'r', encoding='utf-8') as f:
    c = f.read()

nodes = re.findall(r'<node[^>]*text="([^"]*)"[^>]*resource-id="([^"]*)"[^>]*bounds="([^"]*)"', c)
for t, r, b in nodes:
    if t or 'et' in r or 'cb' in r or 'btn' in r or 'row' in r:
        print(f'{r:45} | text: {t:25} | bounds: {b}')
