import subprocess

token = "test-mkt001-token-secret-12345678901234567890"

# Read existing XML
cmd_cat = 'adb -s SSTST8LVZPWGHEQO shell "run-as com.nunes.callcollector cat shared_prefs/nunes_config.xml"'
xml = subprocess.check_output(cmd_cat, shell=True).decode('utf-8', errors='ignore')

if '<string name="device_token">' in xml:
    import re
    xml = re.sub(r'<string name="device_token">[^<]*</string>', f'<string name="device_token">{token}</string>', xml)
else:
    xml = xml.replace('</map>', f'    <string name="device_token">{token}</string>\n</map>')

# Save temp file
with open('F:\\FIREBLADE_GITHUB\\Android_Call_Collector\\android\\scratch\\temp_nunes_config.xml', 'w', encoding='utf-8') as f:
    f.write(xml)

# Push to phone
subprocess.check_call('adb -s SSTST8LVZPWGHEQO push "F:\\FIREBLADE_GITHUB\\Android_Call_Collector\\android\\scratch\\temp_nunes_config.xml" /data/local/tmp/nunes_config.xml', shell=True)
subprocess.check_call('adb -s SSTST8LVZPWGHEQO shell "run-as com.nunes.callcollector cp /data/local/tmp/nunes_config.xml shared_prefs/nunes_config.xml"', shell=True)
subprocess.check_call('adb -s SSTST8LVZPWGHEQO shell "run-as com.nunes.callcollector chmod 660 shared_prefs/nunes_config.xml"', shell=True)

print("Successfully set device_token on MKT-001 phone shared_prefs!")
