export type UserRole = "ADMIN" | "MARKETING" | "MANAGEMENT";
export type FirebladeTheme = "STANDARD" | "NIGHTMARE" | "SYSTEM";

export type SessionUser = {
  username: string;
  role: UserRole;
  auth_user_id?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  force_password_change?: boolean;
  session_version?: number;
  theme?: FirebladeTheme;
  profile_photo_updated_at?: string | null;
};

export type IncomingCall = {
  call_id: number;
  device_id: string;
  collector_employee: string | null;
  phone_number_raw: string | null;
  phone_number_normalized: string | null;
  phone_contact_name: string | null;
  direction: "INCOMING_ANSWERED" | "INCOMING_MISSED" | "OUTGOING_CONNECTED" | "OUTGOING_UNANSWERED" | string;
  started_at_epoch_ms: number;
  started_at: string;
  duration_seconds: number;
  received_at: string;
  call_phone_account_id: string | null;
  call_phone_account_component: string | null;
  call_subscription_id: number | null;
  call_sim_slot_index: number | null;
  registered_employee_id: string | null;
  registered_employee_name: string | null;
  received_by: string | null;
  company_phone_number: string | null;
  device_name: string | null;
  phone_label: string | null;
  resolved_line_id: number | null;
  resolved_line_label: string | null;
  resolved_line_carrier: string | null;
  resolved_sim_slot_index: number | null;
  line_resolution: "EXACT_SIM" | "SINGLE_LINE_FALLBACK" | "MULTI_SIM_UNKNOWN" | "NO_LINE" | null;
  enquiry_id: string | null;
  enquiry_status: "PENDING" | "COMPLETED" | null;
  product_name: string | null;
  requirement_details: string | null;
  notes: string | null;
  entered_by: string | null;
  updated_by: string | null;
  enquiry_created_at: string | null;
  enquiry_updated_at: string | null;
  resolution_outcome?: "DETAILS_ENTERED" | "DISQUALIFIED" | "RECOVERED" | null;
  resolution_at?: string | null;
  resolution_by?: string | null;
  contact_id: string | null;
  person_name: string | null;
  company_name: string | null;
  known_contact_count: number;
  transcript?: string | null;
  relevance_score?: number | null;
  recording_url?: string | null;
};

export type Contact = {
  id: string;
  phone_number_normalized: string;
  person_name: string;
  company_name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FirebladeEmployee = {
  department_id?: string | null;
  profile_photo_path?: string | null;
  profile_photo_updated_at?: string | null;
  employee_id: string;
  employee_name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type FirebladeDevice = {
  device_id: string;
  company_phone_number: string | null;
  device_name: string | null;
  phone_label: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type DeviceAssignment = {
  id: string | number;
  device_id: string;
  employee_id: string;
  assigned_from: string;
  assigned_until: string | null;
  created_at: string;
};

export type FirebladeDeviceLine = {
  id: number;
  device_id: string;
  sim_slot_index: number | null;
  phone_number: string;
  line_label: string | null;
  carrier_name: string | null;
  subscription_id: number | null;
  phone_account_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type TeamRegistry = {
  employees: FirebladeEmployee[];
  devices: FirebladeDevice[];
  assignments: DeviceAssignment[];
  lines: FirebladeDeviceLine[];
};

export type PhoneHealthStatus = "ON" | "OFF" | "UNKNOWN";
export type MobileDataHealthStatus = "ON" | "OFF" | "UNKNOWN";

export type DeviceHealthRecord = {
  received_at?: string | null;
  source_verified?: boolean;
  app_version_code?: number | null;
  permission_state?: Record<string, boolean> | null;
  device_id: string;
  employee_name: string | null;
  heartbeat_at: string;
  event_type: string;
  mobile_data_state: MobileDataHealthStatus;
  internet_available: boolean | null;
  network_type: string | null;
  wifi_connected: boolean | null;
  cellular_connected: boolean | null;
  battery_percent: number | null;
  charging: boolean | null;
  airplane_mode: boolean | null;
  sim_count: number | null;
  sim1_state: string | null;
  sim2_state: string | null;
  default_data_sim_slot: number | null;
  apk_version: string | null;
  android_version: string | null;
  device_model: string | null;
  pending_uploads: number | null;
  last_call_sync_epoch_ms: number | null;
  boot_epoch_ms: number | null;
  collector_state: string | null;
  collector_message: string | null;
  shutdown_confirmed_at: string | null;
  updated_at: string;
};

export type DeviceUpdateInfo = {
  stage: "CURRENT" | "AVAILABLE" | "AWAITING_INSTALL" | "DOWNLOADING" | "FAILED" | "NOT_INSTALLED" | "UNKNOWN";
  can_update: boolean;
  installed_version: string | null;
  installed_code: number | null;
  target_version: string | null;
  target_code: number | null;
  message?: string | null;
  last_checked_at?: string | null;
};

export type DeviceHealthView = {
  state?: import("./device-status").PhoneState;
  phone_working?: "YES" | "NO" | "UNKNOWN";
  internet_status?: string;
  internet_disconnected?: boolean;
  department_id?: string | null;
  department_name?: string;
  device_model?: string | null;
  apk_version?: string | null;
  lines?: FirebladeDeviceLine[];
  check_status?: string;
  check?: import("./device-status").CheckRecord | null;
  device_id: string;
  employee_id: string | null;
  employee_name: string | null;
  profile_photo_updated_at?: string | null;
  company_phone_number: string | null;
  device_name: string | null;
  phone_label: string | null;
  phone_status: PhoneHealthStatus;
  phone_status_detail: "LIVE" | "CONFIRMED_SHUTDOWN" | "STALE" | "NO_DATA" | "CHECKING";
  mobile_data_status: MobileDataHealthStatus;
  last_seen: string | null;
  details?: DeviceHealthRecord | null;
  update_info?: DeviceUpdateInfo;
};

export type CallbackTask = {
  missed_call_id: number;
  employee_id: string;
  employee_name: string | null;
  department_id: string | null;
  department_name: string | null;
  missed_device_id: string;
  phone_number_raw: string | null;
  phone_number_normalized: string | null;
  missed_at_epoch_ms: number;
  missed_at: string;
  missed_date_ist: string;
  callback_call_id: number | null;
  callback_device_id: string | null;
  callback_at_epoch_ms: number | null;
  callback_at: string | null;
  callback_duration_seconds: number | null;
  callback_status: "PENDING" | "RESOLVED";
  callback_minutes: number | null;
};

export type ProductShareProduct = {
  id: string;
  product_code: string;
  canonical_name: string;
  brand: string | null;
  manufacturer: string | null;
  category: string | null;
  subcategory: string | null;
  current_revision_id: string | null;
  specs: Array<{ id: string; spec_key: string; spec_label: string; value_text: string; unit: string | null; customer_priority: number }>;
  assets: Array<{ id: string; asset_type: string; title: string; storage_bucket: string | null; storage_object_path: string | null; revision_label: string | null; sha256: string | null }>;
};

export type ProductCandidate = {
  product_id: string;
  product_code: string;
  canonical_name: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  lexical_score: number;
  vector_score: number;
  final_score: number;
  match_reason: "EXACT_MODEL" | "EXACT_NAME" | "ALIAS_OR_TYPO" | "SEMANTIC" | "LEXICAL";
};

export type ProductVariant = {
  id: string;
  model_code: string | null;
  variant_name: string | null;
  ordering_code: string | null;
};

export type ProductSpec = {
  id: string;
  variant_id: string | null;
  spec_key: string;
  spec_label: string;
  value_text: string;
  numeric_value: number | null;
  unit: string | null;
  customer_priority: number;
};

export type ProductPrice = {
  id: string;
  variant_id: string | null;
  amount: number;
  currency: string;
  tax_note: string | null;
  commercial_note: string | null;
  effective_from: string | null;
  effective_until: string | null;
};

export type ProductAsset = {
  id: string;
  variant_id: string | null;
  asset_type: "CATALOGUE" | "MINI_CATALOGUE" | "DATASHEET" | "IMAGE" | "MANUAL" | "CERTIFICATE" | "DRAWING" | "PRICE_LIST" | "APPLICATION_NOTE" | "OTHER";
  title: string;
  sha256: string | null;
  revision_label: string | null;
  revision_date: string | null;
};

export type FirebladeProductDetail = {
  product: {
    id: string;
    product_code: string;
    canonical_name: string;
    brand: string | null;
    manufacturer: string | null;
    category: string | null;
    subcategory: string | null;
    lifecycle_status: "ACTIVE" | "DISCONTINUED" | "ARCHIVED";
    publish_status: "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED";
    verification_status: "VERIFIED" | "CONFLICT" | "NEEDS_REVIEW";
    current_revision_id: string | null;
  };
  revision: {
    id: string;
    revision_no: number;
    snapshot_sha256: string;
    published_at: string;
  } | null;
  variants: ProductVariant[];
  specs: ProductSpec[];
  prices: ProductPrice[];
  assets: ProductAsset[];
};
