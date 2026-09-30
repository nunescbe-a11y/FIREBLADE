import hashlib
import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from api import index

TOKEN = 'test-device-token-with-adequate-entropy'
HEADERS = {'X-Fireblade-Token': TOKEN}
class DeviceApiTests(unittest.TestCase):
    def setUp(self):
        self.calls=[]
        self.env=patch.dict(os.environ, {'FIREBLADE_INTERNAL_API_KEY':'test-internal-key'}, clear=False)
        self.env.start();self.addCleanup(self.env.stop)
        def database(method,path,payload=None,prefer=None):
            self.calls.append((method,path,payload))
            if path.startswith('fireblade_device_credentials?'):
                return 200,[{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}]
            if path.startswith('fireblade_devices?'):return 200,[{'device_id':'MKT-001'}]
            if path=='rpc/fireblade_respond_check':return 200,True
            if path=='rpc/fireblade_accept_health':return 200,True
            if path=='rpc/fireblade_enroll_device':return 200,False
            if path.startswith('fireblade_app_releases?'):return 200,[]
            if path.startswith('fireblade_device_checks?'):return 200,[]
            if path=='rpc/fireblade_search_products':
                return 200,[{'product_id':'4707479a-620d-46b8-a8de-69722a64a740','product_code':'FB-PROD-001000','canonical_name':'Digital pH Meter VT 10','brand':None,'category':'pH & Acidity Testers','subcategory':'Table-Top Digital pH Meter','lexical_score':1.0,'vector_score':0.0,'final_score':0.92,'match_reason':'EXACT_NAME'}]
            if path.startswith('fireblade_product_search_audit'):return 204,None
            if path.startswith('fireblade_products?select='):
                return 200,[{'id':'4707479a-620d-46b8-a8de-69722a64a740','product_code':'FB-PROD-001000','canonical_name':'Digital pH Meter VT 10','brand':None,'manufacturer':None,'category':'pH & Acidity Testers','subcategory':'Table-Top Digital pH Meter','lifecycle_status':'ACTIVE','publish_status':'PUBLISHED','verification_status':'VERIFIED','current_revision_id':'d6d49d95-48d5-4a67-9283-8880b04675f0'}]
            if path.startswith('fireblade_product_variants?'):
                return 200,[{'id':'11111111-1111-4111-8111-111111111111','model_code':'VT 10','variant_name':None,'ordering_code':None,'verified':True,'status':'ACTIVE'}]
            if path.startswith('fireblade_product_specs?'):return 200,[]
            if path.startswith('fireblade_product_prices?'):return 200,[]
            if path.startswith('fireblade_product_assets?'):return 200,[]
            if path.startswith('fireblade_product_revisions?'):return 200,[{'id':'d6d49d95-48d5-4a67-9283-8880b04675f0','revision_no':1,'snapshot_sha256':'a'*64,'published_at':'2026-09-09T00:00:00+00:00'}]
            return 204,None
        self.mock=patch.object(index,'_supabase',side_effect=database)
        self.mock.start();self.addCleanup(self.mock.stop)
        self.client=TestClient(index.app)
    def test_routes_and_openapi_resolve(self):
        self.assertEqual(self.client.get('/health').json()['version'],'1.3.0')
        self.assertEqual(self.client.get('/openapi.json').status_code,200)
    def test_commands_need_token(self):
        self.assertEqual(self.client.get('/api/v3/devices/MKT-001/commands').status_code,401)
        self.assertEqual(self.client.get('/api/v3/devices/MKT-001/commands',headers={'X-Fireblade-Token':'wrong-token-with-enough-length'}).status_code,401)
        self.assertEqual(self.client.get('/api/v3/devices/MKT-001/commands',headers=HEADERS).json(),{'commands':[]})
    def test_check_response_matches_device(self):
        path='/api/v3/devices/MKT-001/checks/2c06595a-75ae-43de-8159-df334f9b7f38'
        body={'device_id':'MKT-002','observed_at_epoch_ms':100}
        self.assertEqual(self.client.post(path,headers=HEADERS,json=body).status_code,400)
        body['device_id']='MKT-001'
        result=self.client.post(path,headers=HEADERS,json=body)
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['request_id'],path.split('/')[-1])
    def test_database_rejected_response_not_accepted(self):
        with patch.object(index,'_supabase',side_effect=lambda m,p,*a:(200,False) if p=='rpc/fireblade_respond_check' else (200,[{'token_hash':hashlib.sha256(TOKEN.encode()).hexdigest()}])):
            result=self.client.post('/api/v3/devices/MKT-001/checks/2c06595a-75ae-43de-8159-df334f9b7f38',headers=HEADERS,json={'device_id':'MKT-001','observed_at_epoch_ms':100})
        self.assertEqual(result.status_code,409)
    def test_enrolled_health_rejects_unauthenticated_report(self):
        body={'device_id':'MKT-001','observed_at_epoch_ms':100,'event_type':'SHUTDOWN'}
        self.assertEqual(self.client.post('/api/v1/device-health',json=body).status_code,401)
    def test_received_time_does_not_trust_old_phone_clock(self):
        body={'device_id':'MKT-001','observed_at_epoch_ms':100,'event_type':'SHUTDOWN','app_version_code':6}
        result=self.client.post('/api/v1/device-health',json=body,headers=HEADERS)
        self.assertEqual(result.status_code,200,result.text)
        report=[c[2]['p_report'] for c in self.calls if c[1]=='rpc/fireblade_accept_health'][0]
        self.assertIsNone(report['shutdown_confirmed_at'])
        self.assertTrue(report['source_verified'])
        self.assertNotEqual(report['received_at'],'1970-01-01T00:00:00.100000+00:00')
    def test_enrollment_failure_does_not_return_credential(self):
        r=self.client.post('/api/v3/enroll',json={'device_id':'MKT-001','code':'invalid-but-long-enrollment-code'})
        self.assertEqual(r.status_code,401)
        self.assertNotIn('device_token',r.text)
    def test_existing_call_batch_format_and_acknowledgment(self):
        payload={'device_id':'MKT-001','employee_name':'Tester','calls':[{'source_call_id':'42','phone_number_raw':'test','direction':'INCOMING_ANSWERED','started_at_epoch_ms':1788480000000,'duration_seconds':30,'sim_slot_index':1}]}
        r=self.client.post('/api/v1/calls/batch',json=payload)
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['accepted_source_call_ids'],['42'])
        stored=[c for c in self.calls if c[1].startswith('phase0_calls?')][0]
        self.assertEqual(stored[2][0]['sim_slot_index'],1)
        self.assertEqual(stored[1],'phase0_calls?on_conflict=device_id,source_call_id')
    def test_updater_only_returns_published_releases(self):
        r=self.client.get('/api/v3/devices/MKT-001/release?version_code=6',headers=HEADERS)
        self.assertEqual(r.json(),{'available':False})
        self.assertTrue(any('status=eq.PUBLISHED' in c[1] for c in self.calls))
        self.assertTrue(any('target_device_id.is.null' in c[1] and 'target_device_id.eq.MKT-001' in c[1] for c in self.calls))
    def test_arbitrary_update_stage_is_rejected(self):
        r=self.client.post('/api/v3/devices/MKT-001/update-status',headers=HEADERS,json={'stage':'UNINSTALL','app_version_code':6})
        self.assertEqual(r.status_code,422)

    def test_v5_product_search_requires_internal_key_and_returns_candidates(self):
        denied=self.client.get('/api/v5/products/search?q=VT%2010')
        self.assertEqual(denied.status_code,401,denied.text)
        ok=self.client.get('/api/v5/products/search?q=VT%2010',headers={'X-Fireblade-Internal-Key':'test-internal-key','X-Fireblade-Actor':'tester'})
        self.assertEqual(ok.status_code,200,ok.text)
        self.assertEqual(ok.json()['candidates'][0]['product_code'],'FB-PROD-001000')
        self.assertTrue(any(c[1]=='rpc/fireblade_search_products' for c in self.calls))

    def test_v5_product_detail_returns_only_backend_verified_shape(self):
        product_id='4707479a-620d-46b8-a8de-69722a64a740'
        r=self.client.get(f'/api/v5/products/{product_id}',headers={'X-Fireblade-Internal-Key':'test-internal-key'})
        self.assertEqual(r.status_code,200,r.text)
        body=r.json()
        self.assertEqual(body['product']['publish_status'],'PUBLISHED')
        self.assertEqual(body['product']['verification_status'],'VERIFIED')
        self.assertEqual(body['variants'][0]['model_code'],'VT 10')

if __name__=='__main__':unittest.main()
