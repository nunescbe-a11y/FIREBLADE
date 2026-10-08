import os
import sys
import subprocess
import hashlib
import zipfile
import json
import urllib.request
import urllib.parse
import ssl

def check_apk():
    apk_path = r'F:\FIREBLADE_GITHUB\Android_Call_Collector\android\app\build\outputs\apk\release\app-release.apk'
    if not os.path.exists(apk_path):
        print(f"Error: APK not found at {apk_path}")
        return False
    
    with open(apk_path, 'rb') as f:
        data = f.read()
        sha256 = hashlib.sha256(data).hexdigest().upper()
        size = len(data)
    
    print(f"APK Size: {size}")
    print(f"APK SHA-256: {sha256}")
    
    # Run apksigner
    apksigner = r'C:\Users\Nunes\AppData\Local\Android\Sdk\build-tools\34.0.0\apksigner.bat'
    if not os.path.exists(apksigner):
        # find in build-tools
        import glob
        matches = glob.glob(r'C:\Users\Nunes\AppData\Local\Android\Sdk\build-tools\*\apksigner.bat')
        if matches:
            apksigner = matches[0]
    
    if os.path.exists(apksigner):
        res = subprocess.run([apksigner, 'verify', '--print-certs', apk_path], capture_output=True, text=True)
        print("apksigner output:")
        print(res.stdout)
        if res.stderr:
            print("apksigner stderr:", res.stderr)
    else:
        print("apksigner not found at path")
    
    # Run aapt dump badging
    aapt = r'C:\Users\Nunes\AppData\Local\Android\Sdk\build-tools\34.0.0\aapt.exe'
    if not os.path.exists(aapt):
        import glob
        matches = glob.glob(r'C:\Users\Nunes\AppData\Local\Android\Sdk\build-tools\*\aapt.exe')
        if matches:
            aapt = matches[0]
    
    if os.path.exists(aapt):
        res = subprocess.run([aapt, 'dump', 'badging', apk_path], capture_output=True, text=True)
        for line in res.stdout.splitlines():
            if 'package: name=' in line or 'application-label:' in line:
                print("aapt:", line)

if __name__ == '__main__':
    check_apk()
