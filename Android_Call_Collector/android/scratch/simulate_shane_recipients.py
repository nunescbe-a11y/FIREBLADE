import os
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone

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

def simulate_recipients(device_id):
    # Step 1: assignments
    assignments = fetch(f"fireblade_device_assignments?select=employee_id&device_id=eq.{device_id}&assigned_until=is.null&limit=2")
    print(f"[{device_id}] assignments:", assignments)
    if not assignments or len(assignments) != 1:
        print("FAIL: requires 1 active assignment")
        return
    
    employee_id = assignments[0]['employee_id']
    employees = fetch(f"fireblade_employees?select=employee_id,department_id&employee_id=eq.{employee_id}&active=eq.true&limit=1")
    print(f"[{device_id}] employee:", employees)
    if not employees or not employees[0].get('department_id'):
        print("FAIL: employee department not configured")
        return
    
    dept_id = employees[0]['department_id']
    depts = fetch(f"fireblade_departments?select=name&id=eq.{dept_id}&active=eq.true&limit=1")
    dept_name = depts[0]['name'].strip().upper() if depts else ""
    print(f"[{device_id}] department name:", dept_name)
    if dept_name != "SHANE":
        print("FAIL: department is not SHANE")
        return
    
    # Step 2: marketing depts
    all_depts = fetch("fireblade_departments?select=id,name&active=eq.true")
    mkt_dept_ids = {str(d['id']) for d in all_depts if d.get('name', '').strip().upper() == 'MARKETING' and d.get('id')}
    print(f"Marketing Dept IDs: {mkt_dept_ids}")
    
    # Step 3: marketing employees
    all_emps = fetch("fireblade_employees?select=employee_id,employee_name,department_id&active=eq.true&order=employee_name.asc")
    mkt_emps = [e for e in all_emps if str(e.get('department_id')) in mkt_dept_ids]
    print(f"Marketing Employees Count: {len(mkt_emps)}")
    
    # Step 4: active assignments and devices
    act_assigns = fetch("fireblade_device_assignments?select=employee_id,device_id,company_phone_number,assigned_from&assigned_until=is.null&order=assigned_from.desc")
    act_devices = fetch("fireblade_devices?select=device_id,company_phone_number&active=eq.true")
    device_phones = {str(d.get('device_id') or '').strip().upper(): str(d.get('company_phone_number') or '').strip() for d in act_devices if str(d.get('device_id') or '').strip()}
    
    assigns_by_emp = {}
    for a in act_assigns:
        eid = str(a.get('employee_id') or '').strip()
        if eid:
            assigns_by_emp.setdefault(eid, []).append(a)
    
    recipients = []
    for emp in mkt_emps:
        eid = str(emp.get('employee_id') or '').strip()
        phone = ""
        emp_assigns = assigns_by_emp.get(eid, [])
        for r in emp_assigns:
            cand = str(r.get('company_phone_number') or '').strip()
            if cand and cand != 'None':
                phone = cand
                break
        if not phone:
            for r in emp_assigns:
                did = str(r.get('device_id') or '').strip().upper()
                cand = device_phones.get(did, "")
                if cand and cand != 'None':
                    phone = cand
                    break
        recipients.append({
            "employee_id": eid,
            "employee_name": str(emp.get('employee_name') or '').strip(),
            "phone_number": phone,
            "available": bool(phone)
        })
    
    print("\nSimulated Marketing Recipients Result for Shane:")
    print(json.dumps({"department": "MARKETING", "employees": recipients}, indent=2))

if __name__ == '__main__':
    simulate_recipients("MKT-019")
