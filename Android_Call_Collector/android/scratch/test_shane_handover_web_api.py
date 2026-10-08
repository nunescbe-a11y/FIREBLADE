import urllib.request
import json

def get_env():
    env_file = r'F:\FIREBLADE_COMBINED_V3\Fireblade_Website\.env.local'
    env = {}
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"\'')
    return env

env = get_env()
url = env['SUPABASE_URL']
key = env['SUPABASE_SECRET_KEY']

def fetch(path):
    req = urllib.request.Request(f"{url}/rest/v1/{path}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

departments = fetch("fireblade_departments?select=id,name,active&active=eq.true")
employees = fetch("fireblade_employees?select=id,employee_id,employee_name,department_id,active,profile_photo_path,profile_photo_updated_at&active=eq.true&order=employee_name.asc")
assignmentEvents = fetch("fireblade_shane_assignment_events?select=*&order=occurred_at_epoch_ms.desc")
callDetails = fetch("fireblade_shane_call_details?select=*&order=call_started_at_epoch_ms.desc")

deptMap = {d['id']: d['name'].strip().upper() for d in departments}
detailsMap = {d['detail_id']: d for d in callDetails}

eventsByEmp = {}
for evt in assignmentEvents:
    emp_id = (evt.get('assigned_to_employee_id') or '').strip()
    detail = detailsMap.get(evt.get('detail_id'))
    if emp_id and detail:
        eventsByEmp.setdefault(emp_id, []).append((evt, detail))

mkt = []
srv = []

for emp in employees:
    deptName = deptMap.get(emp['department_id'], '')
    isMkt = deptName == 'MARKETING'
    isService = emp['employee_id'] == 'EMP-008' and (deptName == 'SERVICE' or 'ALAGUPRIYA' in emp['employee_name'].upper())
    
    if not isMkt and not isService:
        continue
        
    emp_events = eventsByEmp.get(emp['employee_id'], [])
    rec = {
        'employee_id': emp['employee_id'],
        'employee_name': emp['employee_name'],
        'department_name': 'SERVICE' if isService else 'MARKETING',
        'assignments_count': len(emp_events),
        'assignments_customers': [detail['customer_name'] for evt, detail in emp_events]
    }
    if isService:
        srv.append(rec)
    else:
        mkt.append(rec)

print("--- MARKETING EMPLOYEES ROSTER ---")
for m in mkt:
    print(f"  * {m['employee_name']} ({m['employee_id']}): {m['assignments_count']} assigned customer(s) -> {m['assignments_customers']}")

print("\n--- SERVICE EMPLOYEES ROSTER ---")
for s in srv:
    print(f"  * {s['employee_name']} ({s['employee_id']}): {s['assignments_count']} assigned customer(s) -> {s['assignments_customers']}")
