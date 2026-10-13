import hashlib
import json
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

    def test_recording_upload_missing_token(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'})
        self.assertEqual(r.status_code, 401)

    def test_recording_upload_invalid_token(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, headers={'X-Fireblade-Token': 'wrong-token-with-enough-length'})
        self.assertEqual(r.status_code, 401)
        
    def test_recording_upload_revoked_token(self):
        with patch.object(index, '_supabase', side_effect=lambda m,p,*a: (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':'2026-09-01T00:00:00Z'}]) if 'fireblade_device_credentials' in p else (200, [{'device_id':'MKT-001'}])):
            r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, headers=HEADERS)
            self.assertEqual(r.status_code, 401)

    def test_recording_upload_inactive_device(self):
        with patch.object(index, '_supabase', side_effect=lambda m,p,*a: (200, []) if 'fireblade_devices' in p else (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}])):
            r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, headers=HEADERS)
            self.assertEqual(r.status_code, 403)

    def test_recording_upload_metadata_only_blocked_by_os(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'recording_source':'OS_BLOCKED', 'audio_scope':'NONE', 'capability':'NONE', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':0, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':100, 'mime_type':'audio/mp4'}, headers=HEADERS)
        self.assertEqual(r.status_code, 200, r.text)

    def test_recording_upload_metadata_only_unsupported(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'recording_source':'UNSUPPORTED', 'audio_scope':'NONE', 'capability':'NONE', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':0, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':100, 'mime_type':'audio/mp4'}, headers=HEADERS)
        self.assertEqual(r.status_code, 200, r.text)
        
    def test_recording_upload_audio_checksum_mismatch(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'sha256':'wrongsha', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', b'test audio')}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn('Checksum mismatch', r.text)

    def test_recording_upload_audio_valid_and_unresolved_call_id(self):
        import hashlib
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        with patch('urllib.request.urlopen') as mock_urlopen:
            mock_urlopen.return_value.__enter__.return_value = None
            r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4', 'source_call_id':''}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
            self.assertEqual(r.status_code, 200, r.text)

    def test_recording_upload_normal_recording_without_file(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn('Audio file is required', r.text)

    def test_recording_upload_blank_source_call_id_is_null(self):
        import hashlib
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        with patch('urllib.request.urlopen') as mock_urlopen:
            mock_urlopen.return_value.__enter__.return_value = None
            r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'bded0a3a-750a-480b-be47-66461bdc877e', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4', 'source_call_id': '   '}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
            self.assertEqual(r.status_code, 200, r.text)
        
        # Check what was passed to db
        stored = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
        self.assertIsNone(stored[-1][2]['source_call_id'])

    def test_recording_upload_storage_400_not_duplicate_fails(self):
        import hashlib, urllib.error
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        class MockResponse:
            def read(self): return b'{"message": "Some other error"}'
        err = urllib.error.HTTPError("url", 400, "Bad Request", {}, MockResponse())
        with patch('urllib.request.urlopen', side_effect=err):
            r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
            self.assertEqual(r.status_code, 502)

    def test_recording_upload_duplicate_id_conflict_returns_409(self):
        import hashlib
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        # Mock db to raise HTTPException matching unique constraint
        from fastapi import HTTPException
        def mock_db_conflict(method, path, *args, **kwargs):
            if 'fireblade_call_recordings?' in path:
                raise HTTPException(409, detail="duplicate key value violates unique constraint")
            return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}]) if 'fireblade_device_credentials' in path else (200, [{'device_id':'MKT-001'}])
            
        with patch('urllib.request.urlopen'):
            with patch.object(index, '_supabase', side_effect=mock_db_conflict):
                r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'c5aedb60-9018-4de7-ba9a-7fae02c53798', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
                self.assertEqual(r.status_code, 409)

    def test_recording_upload_call_id_resolution(self):
        import hashlib
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        def mock_db_resolution(method, path, *args, **kwargs):
            if 'phase0_calls?' in path: return (200, [{'id': 12345}])
            if 'fireblade_device_assignments?' in path: return (200, [{'employee_id': 'EMP-001'}])
            if 'fireblade_call_recordings?' in path and method == 'GET': return (200, [])
            self.calls.append((method, path, args[0] if args else None))
            return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}]) if 'fireblade_device_credentials' in path else (200, [{'device_id':'MKT-001'}])
            
        with patch('urllib.request.urlopen'):
            with patch.object(index, '_supabase', side_effect=mock_db_resolution):
                r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': '4de3e615-8306-4da4-86de-163d4ea54231', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4', 'source_call_id':'call_999'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
                self.assertEqual(r.status_code, 200, r.text)
                
        stored = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
        self.assertEqual(stored[-1][2]['call_id'], 12345)
        self.assertEqual(stored[-1][2]['employee_id'], 'EMP-001')

    def test_recording_upload_failed_during_stop_is_metadata_only(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'd2811ea8-5d80-4aa9-a3ed-17a8eb68baa6', 'recording_source':'FAILED_DURING_STOP', 'audio_scope':'NONE', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, headers=HEADERS)
        self.assertEqual(r.status_code, 200, r.text)

    def test_recording_upload_idempotent_retry_returns_200(self):
        import hashlib
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        def mock_db_idempotency(method, path, *args, **kwargs):
            if 'fireblade_call_recordings?' in path and method == 'GET':
                return (200, [{'device_id':'MKT-001', 'sha256':sha, 'upload_status': 'SUCCESS'}])
            return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}]) if 'fireblade_device_credentials' in path else (200, [{'device_id':'MKT-001'}])
            
        with patch('urllib.request.urlopen') as mock_url:
            with patch.object(index, '_supabase', side_effect=mock_db_idempotency):
                r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': '99e81b90-8a07-4034-96df-4cfe762ff7bd', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
                self.assertEqual(r.status_code, 200, r.text)
                mock_url.assert_not_called() # ensure storage was skipped

    def test_recording_upload_idempotent_different_sha_returns_409(self):
        import hashlib
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        def mock_db_idempotency_diff_sha(method, path, *args, **kwargs):
            if 'fireblade_call_recordings?' in path and method == 'GET':
                return (200, [{'device_id':'MKT-001', 'sha256':'different_sha', 'upload_status': 'SUCCESS'}])
            return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}]) if 'fireblade_device_credentials' in path else (200, [{'device_id':'MKT-001'}])
            
        with patch.object(index, '_supabase', side_effect=mock_db_idempotency_diff_sha):
            r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': '95cff039-3bb7-4d28-a3ba-e5e8a121a678', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
            self.assertEqual(r.status_code, 409)

    def test_recording_upload_idempotent_different_device_returns_409(self):
        import hashlib
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        def mock_db_idempotency_diff_device(method, path, *args, **kwargs):
            if 'fireblade_call_recordings?' in path and method == 'GET':
                return (200, [{'device_id':'MKT-999', 'sha256':sha, 'upload_status': 'SUCCESS'}])
            return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}]) if 'fireblade_device_credentials' in path else (200, [{'device_id':'MKT-001'}])
            
        with patch.object(index, '_supabase', side_effect=mock_db_idempotency_diff_device):
            r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': '80ffcee0-8407-4f53-a9ea-5f48bca83156', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
            self.assertEqual(r.status_code, 409)

    def test_recording_upload_idempotent_retry_recovers_from_pending(self):
        import hashlib, urllib.error
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        def mock_db_idempotency_pending(method, path, *args, **kwargs):
            if 'fireblade_call_recordings?' in path and method == 'GET':
                return (200, [{'device_id':'MKT-001', 'sha256':sha, 'upload_status': 'PENDING'}])
            self.calls.append((method, path, args[0] if args else None))
            return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}]) if 'fireblade_device_credentials' in path else (200, [{'device_id':'MKT-001'}])
            
        class MockResponse:
            def read(self): return b'{"statusCode": "400", "error": "Duplicate", "message": "The resource already exists"}'
        err = urllib.error.HTTPError("url", 400, "Bad Request", {}, MockResponse())

        with patch('urllib.request.urlopen', side_effect=err):
            with patch.object(index, '_supabase', side_effect=mock_db_idempotency_pending):
                r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'da36bdae-5c07-4dc9-aab8-5b01c75ec426', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
                self.assertEqual(r.status_code, 200, r.text)

        stored = [c for c in self.calls if 'recording_id=eq.da36bdae-5c07-4dc9-aab8-5b01c75ec426' in c[1]]
        self.assertEqual(stored[-1][0], 'PATCH')
        self.assertEqual(stored[-1][2]['upload_status'], 'SUCCESS')

    def test_recording_upload_overlapping_assignments_yields_null(self):
        import hashlib
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        def mock_db_ambiguous(method, path, *args, **kwargs):
            if 'fireblade_device_assignments?' in path:
                return (200, [{'employee_id': 'EMP-001'}, {'employee_id': 'EMP-002'}])
            if 'fireblade_call_recordings?' in path and method == 'GET': return (200, [])
            self.calls.append((method, path, args[0] if args else None))
            return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}]) if 'fireblade_device_credentials' in path else (200, [{'device_id':'MKT-001'}])
            
        with patch('urllib.request.urlopen'):
            with patch.object(index, '_supabase', side_effect=mock_db_ambiguous):
                r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'abbc7fc5-6402-4bb2-8785-5412ba4317e4', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
                self.assertEqual(r.status_code, 200, r.text)
                
        stored = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
        self.assertIsNone(stored[-1][2]['employee_id'])

    def test_recording_upload_missing_sha256_returns_400(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'b3a96172-768d-49cd-8394-3180a7309704', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', b'test')}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn('sha256 is required', r.text)
        stored = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
        self.assertEqual(len(stored), 0)

    def test_recording_upload_checksum_mismatch_returns_400(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'ddeae5b9-fc7d-48eb-b374-e653659d3b22', 'sha256':'bad', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', b'test')}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn('Checksum mismatch', r.text)
        stored = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
        self.assertEqual(len(stored), 0)

    def test_recording_upload_empty_file_returns_400(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': '397012e9-1008-42c9-a02e-043358880012', 'sha256':'any', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', b'')}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn('payload is empty', r.text)
        stored = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
        self.assertEqual(len(stored), 0)

    def test_recording_upload_unsupported_mime_returns_400(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'b307c7f1-072d-4e12-9f31-ca7b3f1c3d11', 'sha256':'any', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mpeg'}, files={'file': ('rec.mp4', b'test')}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn('Unsupported MIME type', r.text)
        stored = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
        self.assertEqual(len(stored), 0)

    def test_recording_upload_valid_retry_succeeds_after_malformed(self):
        import hashlib
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        
        def mock_db_fresh(method, path, *args, **kwargs):
            if 'fireblade_call_recordings?' in path and method == 'GET':
                return (200, [])
            self.calls.append((method, path, args[0] if args else None))
            return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}]) if 'fireblade_device_credentials' in path else (200, [{'device_id':'MKT-001'}])
            
        with patch('urllib.request.urlopen'):
            with patch.object(index, '_supabase', side_effect=mock_db_fresh):
                # 1. Malformed request (missing sha256)
                r1 = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'f6ff02bd-8c09-44af-ac03-143b68bd02e8', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
                self.assertEqual(r1.status_code, 400)
                
                # Verify no DB row created
                stored1 = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
                self.assertEqual(len(stored1), 0)
                
                # 2. Corrected valid request
                r2 = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id': 'f6ff02bd-8c09-44af-ac03-143b68bd02e8', 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
                self.assertEqual(r2.status_code, 200)
                
                # Verify DB row was now created properly
                stored2 = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
                self.assertEqual(len(stored2), 1)

    def test_recording_upload_invalid_uuid_returns_400(self):
        r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id':'not-a-uuid', 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', b'test')}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn('Invalid recording_id format', r.text)
        stored = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
        self.assertEqual(len(stored), 0)

    def test_recording_upload_valid_uuid_uploads_normally(self):
        import hashlib
        import uuid
        content = b'test audio'
        sha = hashlib.sha256(content).hexdigest()
        rec_uuid = str(uuid.uuid4())
        
        def mock_db_fresh(method, path, *args, **kwargs):
            if 'fireblade_call_recordings?' in path and method == 'GET':
                return (200, [])
            self.calls.append((method, path, args[0] if args else None))
            return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}]) if 'fireblade_device_credentials' in path else (200, [{'device_id':'MKT-001'}])
            
        with patch('urllib.request.urlopen') as mock_urlopen:
            with patch.object(index, '_supabase', side_effect=mock_db_fresh):
                r = self.client.post('/api/v3/recordings', data={'device_id':'MKT-001', 'recording_id':rec_uuid, 'sha256':sha, 'recording_source':'MEDIARECORDER_MIC', 'audio_scope':'EMPLOYEE_ONLY', 'capability':'MIC_ONLY', 'employee_notice_status':'NOT_CAPTURED', 'customer_consent_status':'UNKNOWN', 'consent_basis':'NOT_RECORDED', 'duration_ms':1000, 'started_at_epoch_ms':100, 'ended_at_epoch_ms':1100, 'mime_type':'audio/mp4'}, files={'file': ('rec.mp4', content)}, headers=HEADERS)
                self.assertEqual(r.status_code, 200)
                stored = [c for c in self.calls if c[1] == 'fireblade_call_recordings']
                self.assertEqual(len(stored), 1)
                self.assertEqual(stored[0][2]['recording_id'], rec_uuid)
                mock_urlopen.assert_called_once()

    def test_call_details_upload_any_department(self):
        import uuid
        detail_uuid = str(uuid.uuid4())
        
        def mock_db_details(method, path, *args, **kwargs):
            self.calls.append((method, path, args[0] if args else None))
            if 'fireblade_device_credentials' in path:
                return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}])
            if 'fireblade_devices' in path:
                return (200, [{'device_id':'MKT-001'}])
            if 'fireblade_device_assignments' in path:
                return (200, [{'employee_id':'EMP-TEST-001'}])
            if 'phase0_calls' in path:
                return (200, [{'id':123, 'employee_name':'Tester'}])
            if 'fireblade_contacts' in path and method == 'GET':
                return (200, [{'id':'c1111111-1111-1111-1111-111111111111'}])
            if 'fireblade_call_enquiries' in path and method == 'GET':
                return (200, [{'id':'e1111111-1111-1111-1111-111111111111'}])
            if 'fireblade_information_types' in path:
                return (200, [{'id':'t1', 'code':'QUOTATION'}, {'id':'t2', 'code':'CATALOGUE'}, {'id':'t3', 'code':'IMAGE'}])
            if 'fireblade_shane_call_details' in path and method == 'GET':
                return (200, [])
            return (200, [])

        with patch.object(index, '_supabase', side_effect=mock_db_details):
            payload = {
                "device_id": "MKT-001",
                "detail_id": detail_uuid,
                "source_call_id": "call-src-99",
                "phone_number_raw": "9876543210",
                "phone_number_normalized": "+919876543210",
                "call_started_at_epoch_ms": 1788480000000,
                "customer_name": "John Doe",
                "product_asked": "Digital pH Meter",
                "location": "Chennai",
                "notes": "Urgent enquiry",
                "quotation": True,
                "catalogue": False,
                "image": True,
                "very_urgent": True,
                "updated_at_epoch_ms": 1788480001000
            }
            r = self.client.post('/api/v3/shane/call-details', json=payload, headers=HEADERS)
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(r.json(), {"ok": True, "detail_id": detail_uuid, "report_sync_status": "SYNCED"})

            # Also verify /api/v3/call-details alias
            r2 = self.client.post('/api/v3/call-details', json=payload, headers=HEADERS)
            self.assertEqual(r2.status_code, 200, r2.text)

    def test_shane_assignment_events_and_recipients_mkt001(self):
        import uuid
        detail_uuid = str(uuid.uuid4())
        event_uuid = str(uuid.uuid4())

        def mock_db(method, path, *args, **kwargs):
            if 'fireblade_device_credentials' in path:
                return (200, [{'device_id':'MKT-001','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}])
            if 'fireblade_devices' in path:
                return (200, [{'device_id':'MKT-001'}])
            if 'fireblade_device_assignments' in path:
                return (200, [{'employee_id':'EMP-017'}])
            if 'fireblade_employees' in path:
                if 'EMP-017' in path:
                    return (200, [{'employee_id':'EMP-017','department_id':'dept-shane','active':True}])
                return (200, [{'employee_id':'EMP-MKT-1','department_id':'dept-mkt','active':True}])
            if 'fireblade_departments' in path:
                if 'dept-shane' in path:
                    return (200, [{'name':'SHANE','active':True}])
                return (200, [{'name':'MARKETING','active':True}])
            if 'fireblade_shane_call_details' in path:
                return (200, [{'detail_id':detail_uuid,'device_id':'MKT-001','employee_id':'EMP-017'}])
            return (200, [])

        with patch.object(index, '_supabase', side_effect=mock_db):
            rec_r = self.client.get('/api/v3/devices/MKT-001/shane/marketing-recipients', headers=HEADERS)
            self.assertEqual(rec_r.status_code, 200, rec_r.text)

            payload = {
                "device_id": "MKT-001",
                "event_id": event_uuid,
                "detail_id": detail_uuid,
                "assigned_to_employee_id": "EMP-MKT-1",
                "event_type": "ASSIGNED",
                "occurred_at_epoch_ms": 1788480000000,
                "whatsapp_recipient_number": "+919876543210",
                "form_snapshot": {"customer_name": "Test Customer"}
            }
            evt_r = self.client.post('/api/v3/shane/assignment-events', json=payload, headers=HEADERS)
            self.assertEqual(evt_r.status_code, 200, evt_r.text)
            self.assertEqual(evt_r.json(), {"ok": True, "event_id": event_uuid})

    def test_mkt019_can_select_mkt001_test_recipient_and_save_assignment(self):
        import uuid
        detail_id = str(uuid.uuid4())
        event_id = str(uuid.uuid4())
        writes = []

        def mock_db(method, path, *args, **kwargs):
            if "fireblade_device_credentials?" in path:
                return (200, [{"token_hash": hashlib.sha256(TOKEN.encode()).hexdigest(),
                               "revoked_at": None}])
            if "fireblade_devices?select=device_id,company_phone_number" in path:
                return (200, [{"device_id": "MKT-001", "company_phone_number": None},
                              {"device_id": "MKT-019", "company_phone_number": "9000000000"}])
            if "fireblade_devices?" in path:
                return (200, [{"device_id": "MKT-019"}])
            if "fireblade_device_assignments?" in path:
                if "select=employee_id,device_id,company_phone_number" in path:
                    return (200, [
                        {"employee_id": "TEST-SHANE-001", "device_id": "MKT-001",
                         "company_phone_number": "9000000001"},
                        {"employee_id": "EMP-017", "device_id": "MKT-019",
                         "company_phone_number": None}
                    ])
                if "device_id=eq.MKT-001" in path:
                    return (200, [{"employee_id": "TEST-SHANE-001"}])
                return (200, [{"employee_id": "EMP-017"}])
            if "fireblade_employees?" in path:
                if "select=employee_id,employee_name,department_id" in path:
                    return (200, [
                        {"employee_id": "TEST-SHANE-001", "employee_name": "SHANE TEST",
                         "department_id": "dept-shane"},
                        {"employee_id": "EMP-OTHER-SHANE", "employee_name": "Other Shane",
                         "department_id": "dept-shane"},
                        {"employee_id": "EMP-MKT-1", "employee_name": "Marketing A",
                         "department_id": "dept-marketing"}
                    ])
                if "employee_id=eq.TEST-SHANE-001" in path:
                    return (200, [{"employee_id": "TEST-SHANE-001",
                                   "department_id": "dept-shane", "active": True}])
                return (200, [{"employee_id": "EMP-017",
                               "department_id": "dept-shane", "active": True}])
            if "fireblade_departments?" in path:
                if "select=id,name" in path:
                    return (200, [{"id": "dept-shane", "name": "SHANE"},
                                  {"id": "dept-marketing", "name": "MARKETING"}])
                return (200, [{"name": "SHANE", "active": True}])
            if "fireblade_shane_call_details?" in path:
                return (200, [{"detail_id": detail_id, "device_id": "MKT-019",
                               "employee_id": "EMP-017"}])
            if "fireblade_shane_assignment_events?" in path:
                if method == "POST":
                    writes.append(args[0])
                return (200, [])
            return (200, [])

        with patch.object(index, "_supabase", side_effect=mock_db):
            recipients = self.client.get(
                "/api/v3/devices/MKT-019/shane/marketing-recipients",
                headers=HEADERS
            )
            self.assertEqual(recipients.status_code, 200, recipients.text)
            test_rows = [e for e in recipients.json()["employees"]
                         if e["employee_id"] == "TEST-SHANE-001"]
            self.assertEqual(len(test_rows), 1)
            self.assertTrue(test_rows[0]["available"])
            self.assertEqual(test_rows[0]["phone_number"], "9000000001")
            self.assertEqual(
                test_rows[0]["employee_name"],
                "TEST PHONE (MKT-001) - 9000000001"
            )
            self.assertNotIn(
                "EMP-OTHER-SHANE",
                [e["employee_id"] for e in recipients.json()["employees"]]
            )
            # Other Shane / test senders must not see the special entry.
            other = self.client.get(
                "/api/v3/devices/MKT-001/shane/marketing-recipients",
                headers=HEADERS
            )
            self.assertEqual(other.status_code, 200, other.text)
            self.assertNotIn(
                "TEST-SHANE-001",
                [e["employee_id"] for e in other.json()["employees"]]
            )
            assigned = self.client.post(
                "/api/v3/shane/assignment-events",
                headers=HEADERS,
                json={
                    "device_id": "MKT-019", "event_id": event_id,
                    "detail_id": detail_id,
                    "assigned_to_employee_id": "TEST-SHANE-001",
                    "event_type": "ASSIGNED",
                    "occurred_at_epoch_ms": 1788480000000,
                    "whatsapp_recipient_number": "9000000001",
                    "form_snapshot": {"customer_name": "Test Customer"}
                }
            )
            self.assertEqual(assigned.status_code, 200, assigned.text)
            self.assertEqual(writes[0]["assigned_to_employee_id"], "TEST-SHANE-001")
            self.assertNotIn("group_mode_enabled", recipients.json())

    def test_employee_assigned_customers_and_single_save_details(self):
        import uuid
        detail_uuid = str(uuid.uuid4())
        event_uuid = str(uuid.uuid4())
        save_uuid = str(uuid.uuid4())

        def mock_db(method, path, *args, **kwargs):
            if 'fireblade_device_credentials' in path:
                return (200, [{'device_id':'MKT-006','token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),'revoked_at':None}])
            if 'fireblade_devices' in path:
                return (200, [{'device_id':'MKT-006'}])
            if 'fireblade_device_assignments' in path:
                return (200, [{'employee_id':'EMP-004'}])
            if 'fireblade_shane_assignment_events' in path:
                if method == 'GET':
                    return (200, [
                        {
                            'event_id': event_uuid,
                            'detail_id': detail_uuid,
                            'assigned_to_employee_id': 'EMP-004',
                            'event_type': 'ASSIGNED',
                            'occurred_at_epoch_ms': 1788480050000,
                            'whatsapp_recipient_number': '6380371372',
                            'form_snapshot': {}
                        }
                    ])
                return (200, [])
            if 'fireblade_shane_call_details' in path:
                return (200, [{
                    'detail_id': detail_uuid,
                    'device_id': 'MKT-019',
                    'employee_id': 'EMP-017',
                    'customer_name': 'Test Customer Yazhini',
                    'phone_number_raw': '9876543210',
                    'phone_number_normalized': '+919876543210',
                    'product_asked': 'Fire Extinguisher ABC',
                    'location': 'Chennai',
                    'notes': 'Urgent customer enquiry',
                    'very_urgent': True,
                    'call_started_at_epoch_ms': 1788480000000
                }])
            return (200, [])

        with patch.object(index, '_supabase', side_effect=mock_db):
            # 1. Get assigned customers for employee receiver
            r = self.client.get('/api/v3/devices/MKT-006/assigned-customers', headers=HEADERS)
            self.assertEqual(r.status_code, 200, r.text)
            data = r.json()
            self.assertTrue(data.get("ok"))
            self.assertEqual(data.get("employee_id"), "EMP-004")
            self.assertEqual(len(data.get("assigned_customers")), 1)
            item = data["assigned_customers"][0]
            self.assertEqual(item["customer_name"], "Test Customer Yazhini")
            self.assertEqual(item["source_kind"], "ORIGINAL")
            self.assertEqual(item["source_title"], "Original Shane's Handover")
            self.assertEqual(item["status"], "PENDING")
            self.assertTrue(item["very_urgent"])

            # 2. Save follow-up details with single timestamp
            save_payload = {
                "event_id": save_uuid,
                "quotation": True,
                "catalogue": False,
                "image": True,
                "common_remarks": "Quotation and images sent via WhatsApp",
                "saved_at_epoch_ms": 1788480100000
            }
            save_r = self.client.post(f'/api/v3/devices/MKT-006/assigned-customers/{detail_uuid}/save-details', json=save_payload, headers=HEADERS)
            self.assertEqual(save_r.status_code, 200, save_r.text)
            self.assertEqual(save_r.json(), {
                "ok": True,
                "detail_id": detail_uuid,
                "event_id": save_uuid,
                "saved_at_epoch_ms": 1788480100000
            })

            # 3. Post assignment receipt
            receipt_payload = {
                "receipt_type": "RECEIVED_ON_APP",
                "occurred_at_epoch_ms": 1788480060000
            }
            rec_r = self.client.post(f'/api/v3/devices/MKT-006/assigned-customers/{detail_uuid}/receipt', json=receipt_payload, headers=HEADERS)
            self.assertEqual(rec_r.status_code, 200, rec_r.text)
            self.assertEqual(rec_r.json(), {"ok": True, "detail_id": detail_uuid, "receipt_type": "RECEIVED_ON_APP"})


    def test_inbox_endpoints_are_registered_in_openapi(self):
        paths = self.client.get('/openapi.json').json()['paths']
        self.assertIn('/api/v3/devices/{device_id}/assigned-customers', paths)
        self.assertIn('/api/v3/devices/{device_id}/assigned-customers/{detail_id}/receipt', paths)
        self.assertIn('/api/v3/devices/{device_id}/assigned-customers/{detail_id}/save-details', paths)

    def test_receipt_requires_saved_assignment_for_same_employee(self):
        import uuid
        detail_id = str(uuid.uuid4())
        def db_without_assignment(method, path, *args, **kwargs):
            if 'fireblade_device_credentials' in path:
                return (200, [{'device_id': 'MKT-006',
                                'token_hash': hashlib.sha256(TOKEN.encode()).hexdigest(),
                                'revoked_at': None}])
            if 'fireblade_devices' in path:
                return (200, [{'device_id': 'MKT-006'}])
            if 'fireblade_device_assignments' in path:
                return (200, [{'employee_id': 'EMP-004'}])
            if 'fireblade_shane_assignment_events' in path:
                return (200, [])
            return (200, [])
        with patch.object(index, '_supabase', side_effect=db_without_assignment):
            response = self.client.post(
                f'/api/v3/devices/MKT-006/assigned-customers/{detail_id}/receipt',
                headers=HEADERS,
                json={'receipt_type': 'RECEIVED_ON_APP',
                      'occurred_at_epoch_ms': 1788480060000}
            )
        self.assertEqual(response.status_code, 403, response.text)
        self.assertIn('No assignment', response.text)

    def test_whatsapp_open_without_saved_assignment_does_not_deliver(self):
        # Opening WhatsApp is a separate, optional action: only Save & Send
        # creating an ASSIGNED event makes a customer visible in Fireblade.
        import uuid
        detail_id = str(uuid.uuid4())
        whatsapp_event = str(uuid.uuid4())

        def mock_db(method, path, *args, **kwargs):
            if 'fireblade_device_credentials' in path:
                return (200, [{'device_id': 'MKT-010',
                                'token_hash': hashlib.sha256(TOKEN.encode()).hexdigest(),
                                'revoked_at': None}])
            if 'fireblade_devices' in path:
                return (200, [{'device_id': 'MKT-010'}])
            if 'fireblade_device_assignments' in path:
                return (200, [{'employee_id': 'EMP-008'}])
            if 'fireblade_shane_assignment_events' in path:
                if method == 'GET' and 'select=*' in path:
                    return (200, [{
                        'event_id': whatsapp_event,
                        'detail_id': detail_id,
                        'assigned_to_employee_id': 'EMP-008',
                        'event_type': 'WHATSAPP_HANDOFF_OPENED',
                        'occurred_at_epoch_ms': 1788480050000,
                        'form_snapshot': {}
                    }])
                return (200, [])
            if 'fireblade_shane_call_details' in path:
                return (200, [{
                    'detail_id': detail_id, 'device_id': 'MKT-019',
                    'employee_id': 'EMP-017', 'customer_name': 'No Assignment'
                }])
            return (200, [])

        with patch.object(index, '_supabase', side_effect=mock_db):
            result = self.client.get('/api/v3/devices/MKT-010/assigned-customers', headers=HEADERS)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['assigned_customers'], [])
            receipt = self.client.post(
                f'/api/v3/devices/MKT-010/assigned-customers/{detail_id}/receipt',
                headers=HEADERS,
                json={'receipt_type': 'RECEIVED_ON_APP',
                      'occurred_at_epoch_ms': 1788480060000}
            )
            self.assertEqual(receipt.status_code, 403)
            self.assertIn('No assignment', receipt.text)

    def test_service_employee_receives_saved_assignment_without_whatsapp(self):
        # EMP-008 is the explicitly authorized Service recipient Alagupriya.
        import uuid
        detail_id = str(uuid.uuid4())
        event_id = str(uuid.uuid4())

        def mock_db(method, path, *args, **kwargs):
            if 'fireblade_device_credentials' in path:
                return (200, [{'device_id': 'MKT-010',
                                'token_hash': hashlib.sha256(TOKEN.encode()).hexdigest(),
                                'revoked_at': None}])
            if 'fireblade_devices' in path:
                return (200, [{'device_id': 'MKT-010'}])
            if 'fireblade_device_assignments' in path:
                return (200, [{'employee_id': 'EMP-008'}])
            if 'fireblade_shane_assignment_events' in path:
                if method == 'GET' and 'select=*' in path:
                    return (200, [{
                        'event_id': event_id,
                        'detail_id': detail_id,
                        'assigned_to_employee_id': 'EMP-008',
                        'event_type': 'ASSIGNED',
                        'occurred_at_epoch_ms': 1788480050000,
                        'form_snapshot': {}
                    }])
                if method == 'GET' and 'event_type=eq.ASSIGNED' in path:
                    return (200, [{'event_id': event_id}])
                return (200, [])
            if 'fireblade_shane_call_details' in path:
                return (200, [{
                    'detail_id': detail_id, 'device_id': 'MKT-019',
                    'employee_id': 'EMP-017',
                    'customer_name': 'Customer for Alagupriya',
                    'phone_number_raw': '9876543210',
                    'product_asked': 'Water Pump',
                    'location': 'Coimbatore',
                    'notes': 'Please contact',
                    'call_started_at_epoch_ms': 1788480000000
                }])
            return (200, [])

        with patch.object(index, '_supabase', side_effect=mock_db):
            response = self.client.get('/api/v3/devices/MKT-010/assigned-customers', headers=HEADERS)
            self.assertEqual(response.status_code, 200, response.text)
            customers = response.json()['assigned_customers']
            self.assertEqual(len(customers), 1)
            self.assertEqual(customers[0]['customer_name'], 'Customer for Alagupriya')
            self.assertEqual(customers[0]['assignment_event_id'], event_id)
            self.assertEqual(customers[0]['assigned_at_epoch_ms'], 1788480050000)
            receipt = self.client.post(
                f'/api/v3/devices/MKT-010/assigned-customers/{detail_id}/receipt',
                headers=HEADERS,
                json={'receipt_type': 'RECEIVED_ON_APP',
                      'occurred_at_epoch_ms': 1788480060000}
            )
            self.assertEqual(receipt.status_code, 200, receipt.text)

    def test_mkt001_receives_mkt019_assigned_test_customer_once(self):
        # Two saves of the same detail create two ASSIGNED events, but only
        # one customer should appear on the test phone's Assigned tab.
        import uuid
        detail_id = str(uuid.uuid4())
        event_first = str(uuid.uuid4())
        event_second = str(uuid.uuid4())
        events = [
            {"event_id": event_second, "detail_id": detail_id,
             "assigned_to_employee_id": "TEST-SHANE-001",
             "event_type": "ASSIGNED", "occurred_at_epoch_ms": 1788480060000,
             "form_snapshot": {}},
            {"event_id": event_first, "detail_id": detail_id,
             "assigned_to_employee_id": "TEST-SHANE-001",
             "event_type": "ASSIGNED", "occurred_at_epoch_ms": 1788480050000,
             "form_snapshot": {}},
        ]

        def mock_db(method, path, *args, **kwargs):
            if "fireblade_device_credentials?" in path:
                return (200, [{"token_hash": hashlib.sha256(TOKEN.encode()).hexdigest(),
                                "revoked_at": None}])
            if "fireblade_devices?" in path:
                return (200, [{"device_id": "MKT-001"}])
            if "fireblade_device_assignments?" in path:
                return (200, [{"employee_id": "TEST-SHANE-001"}])
            if "fireblade_shane_assignment_events?" in path:
                if "select=*" in path:
                    self.assertIn("assigned_to_employee_id=eq.TEST-SHANE-001", path)
                    return (200, events)
                return (200, [{"event_id": event_second}])
            if "fireblade_shane_call_details?" in path:
                return (200, [{
                    "detail_id": detail_id,
                    "device_id": "MKT-019", "employee_id": "EMP-017",
                    "customer_name": "Test Customer",
                    "phone_number_raw": "9876543210",
                    "product_asked": "Water Pump",
                    "location": "Coimbatore",
                    "notes": "Call soon",
                    "call_started_at_epoch_ms": 1788480000000
                }])
            return (200, [])

        with patch.object(index, "_supabase", side_effect=mock_db):
            inbox = self.client.get(
                "/api/v3/devices/MKT-001/assigned-customers", headers=HEADERS
            )
            self.assertEqual(inbox.status_code, 200, inbox.text)
            self.assertEqual(inbox.json()["employee_id"], "TEST-SHANE-001")
            customers = inbox.json()["assigned_customers"]
            self.assertEqual(len(customers), 1)
            self.assertEqual(customers[0]["customer_name"], "Test Customer")
            self.assertEqual(customers[0]["customer_phone_raw"], "9876543210")
            self.assertEqual(customers[0]["assignment_event_id"], event_second)
            receipt = self.client.post(
                f"/api/v3/devices/MKT-001/assigned-customers/{detail_id}/receipt",
                headers=HEADERS,
                json={"receipt_type": "RECEIVED_ON_APP",
                      "occurred_at_epoch_ms": 1788480070000}
            )
            self.assertEqual(receipt.status_code, 200, receipt.text)

    def test_employee_save_requires_common_remarks_if_any_item_is_no(self):
        import uuid
        detail_id = str(uuid.uuid4())
        def employee_db(method, path, *args, **kwargs):
            if 'fireblade_device_credentials' in path:
                return (200, [{'device_id': 'MKT-006',
                                'token_hash': hashlib.sha256(TOKEN.encode()).hexdigest(),
                                'revoked_at': None}])
            if 'fireblade_devices' in path:
                return (200, [{'device_id': 'MKT-006'}])
            if 'fireblade_device_assignments' in path:
                return (200, [{'employee_id': 'EMP-004'}])
            if 'fireblade_shane_assignment_events' in path:
                return (200, [{'event_id': str(uuid.uuid4())}])
            return (200, [])
        with patch.object(index, '_supabase', side_effect=employee_db):
            response = self.client.post(
                f'/api/v3/devices/MKT-006/assigned-customers/{detail_id}/save-details',
                headers=HEADERS,
                json={'event_id': str(uuid.uuid4()), 'quotation': True,
                      'image': True, 'catalogue': False,
                      'common_remarks': '', 'saved_at_epoch_ms': 1788480100000}
            )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn('Common Remarks', response.text)

if __name__=='__main__':unittest.main()
