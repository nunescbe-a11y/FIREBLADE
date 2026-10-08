import subprocess
import re

output = subprocess.check_output('adb -s SSTST8LVZPWGHEQO shell "run-as com.nunes.callcollector cat shared_prefs/nunes_config.xml"', shell=True).decode('utf-8', errors='ignore')

match = re.search(r'<string name="device_token">([^<]+)</string>', output)
if match:
    print("FOUND MKT-001 TOKEN:", match.group(1))
else:
    print("Token string not found directly, checking all entries:")
    for m in re.finditer(r'<string name="([^"]+)">([^<]*)</string>', output):
        print(f"  - {m.group(1)}: {m.group(2)[:40]}")
