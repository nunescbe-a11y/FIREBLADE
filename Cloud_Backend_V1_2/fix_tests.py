import re, uuid

with open('tests/test_api.py', 'r') as f:
    content = f.read()

# Map each unique rec_ string to a specific UUID so they are consistent across retries in the same test
mapping = {}
def repl(m):
    original = m.group(1)
    if original not in mapping:
        mapping[original] = str(uuid.uuid4())
    return "'recording_id': '" + mapping[original] + "'"

content = re.sub(r"'recording_id':\s*'([^']+)'", lambda m: repl(m) if m.group(1).startswith('rec') else m.group(0), content)

# There is also one place where we check self.calls for 'recording_id=eq.rec_pending_retry'
def repl2(m):
    original = m.group(1)
    return "recording_id=eq." + mapping.get(original, original)

content = re.sub(r"recording_id=eq\.(rec_[a-zA-Z_0-9]+)", repl2, content)

with open('tests/test_api.py', 'w') as f:
    f.write(content)
