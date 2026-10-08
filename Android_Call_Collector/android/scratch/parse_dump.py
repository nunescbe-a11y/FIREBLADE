import sys
import xml.etree.ElementTree as ET

filename = sys.argv[1] if len(sys.argv) > 1 else 'F:/FIREBLADE_GITHUB/Android_Call_Collector/android/scratch/detail_bottom_dump.xml'
tree = ET.parse(filename)
root = tree.getroot()

for node in root.iter('node'):
    rid = node.attrib.get('resource-id', '')
    text = node.attrib.get('text', '')
    cls = node.attrib.get('class', '')
    bounds = node.attrib.get('bounds', '')
    checked = node.attrib.get('checked', '')
    if rid or text:
        print(f"ID: {rid} | Text: \"{text}\" | Checked: {checked} | Class: {cls} | Bounds: {bounds}")
