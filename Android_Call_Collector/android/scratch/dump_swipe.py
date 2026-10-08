import subprocess
import re
import time

def run(cmd):
    return subprocess.run(['adb', '-s', 'SSTST8LVZPWGHEQO'] + cmd, capture_output=True, text=True).stdout.strip()

print('Swiping up from 1200 to 200...')
run(['shell', 'input', 'swipe', '360', '1200', '360', '200', '400'])
time.sleep(1)

run(['shell', 'uiautomator', 'dump', '/sdcard/dump_after_swipe.xml'])
run(['pull', '/sdcard/dump_after_swipe.xml', 'scratch/dump_after_swipe.xml'])

with open('scratch/dump_after_swipe.xml', 'r', encoding='utf-8') as f:
    c = f.read()

nodes = re.findall(r'<node[^>]*text="([^"]*)"[^>]*resource-id="([^"]*)"[^>]*bounds="([^"]*)"', c)
for t, r, b in nodes:
    if t or 'et' in r or 'cb' in r or 'btn' in r or 'row' in r:
        print(f'{r:45} | text: {t:25} | bounds: {b}')
