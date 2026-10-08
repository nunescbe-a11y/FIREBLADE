import os
import json
import urllib.request
import urllib.parse

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
supabase_url = env['SUPABASE_URL']
supabase_key = env['SUPABASE_SECRET_KEY']

def fetch(path):
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/{path}",
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}"
        }
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

# Check MKT-019 assignment
mkt019_assign = fetch("fireblade_device_assignments?select=*&device_id=eq.MKT-019&assigned_until=is.null")
print("MKT-019 active assignment:")
print(json.dumps(mkt019_assign, indent=2))

if mkt019_assign:
    emp_id = mkt019_assign[0]['employee_id']
    emp = fetch(f"fireblade_employees?select=*&employee_id=eq.{emp_id}")
    print("\nShane Employee record:")
    print(json.dumps(emp, indent=2))
    
    if emp and emp[0].get('department_id'):
        dept_id = emp[0]['department_id']
        dept = fetch(f"fireblade_departments?select=*&id=eq.{dept_id}")
        print("\nShane Department record:")
        print(json.dumps(dept, indent=2))

# Check Marketing Department and Employees
depts = fetch("fireblade_departments?select=*&active=eq.true")
print("\nActive Departments:")
print(json.dumps(depts, indent=2))

mkt_depts = [d['id'] for d in depts if d.get('name', '').strip().upper() == 'MARKETING']
if mkt_depts:
    mkt_emps = fetch(f"fireblade_employees?select=*&department_id=in.({','.join(map(str, mkt_depts))})&active=eq.true")
    print(f"\nActive Marketing Employees ({len(mkt_emps)}):")
    for me in mkt_emps:
        print(f"  * {me.get('employee_name')} ({me.get('employee_id')})")
    
    # Active assignments for these employees
    mkt_emp_ids = [me['employee_id'] for me in mkt_emps]
    assigns = fetch(f"fireblade_device_assignments?select=*&assigned_until=is.null")
    print(f"\nAll Active Device Assignments ({len(assigns)}):")
    for a in assigns:
        print(f"  * Employee {a.get('employee_id')} -> Device {a.get('device_id')} (phone: {a.get('company_phone_number')})")
