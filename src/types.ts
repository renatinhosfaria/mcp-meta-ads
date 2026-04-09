export interface MetaApiResponse<T> {
  data: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
  summary?: Record<string, unknown>;
}

export interface MetaApiSingleResponse<T> {
  data: T;
}

export interface MetaApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    error_user_msg?: string;
    error_user_title?: string;
    fbtrace_id?: string;
  };
}

export interface AdAccount {
  id: string;
  name: string;
  account_id: string;
  account_status: number;
  currency: string;
  timezone_name: string;
  amount_spent: string;
  balance: string;
  spend_cap?: string;
  business?: {
    id: string;
    name: string;
  };
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  spend_cap?: string;
  bid_strategy?: string;
  buying_type?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
  special_ad_categories?: string[];
}

export interface Targeting {
  age_min?: number;
  age_max?: number;
  genders?: number[];
  geo_locations?: {
    countries?: string[];
    regions?: Array<{ key: string }>;
    cities?: Array<{ key: string; radius: number; distance_unit: string }>;
  };
  interests?: Array<{ id: string; name: string }>;
  behaviors?: Array<{ id: string; name: string }>;
  custom_audiences?: Array<{ id: string }>;
  excluded_custom_audiences?: Array<{ id: string }>;
  device_platforms?: string[];
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  flexible_spec?: Array<Record<string, unknown>>;
}

export interface AdSet {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_amount?: number;
  bid_strategy?: string;
  targeting?: Targeting;
  start_time?: string;
  end_time?: string;
  created_time?: string;
  updated_time?: string;
}

export interface AdCreative {
  id?: string;
  name?: string;
  title?: string;
  body?: string;
  image_hash?: string;
  image_url?: string;
  video_id?: string;
  link_url?: string;
  call_to_action_type?: string;
  object_story_spec?: Record<string, unknown>;
  asset_feed_spec?: Record<string, unknown>;
  effective_object_story_id?: string;
  url_tags?: string;
  thumbnail_url?: string;
  object_type?: string;
  degrees_of_freedom_spec?: Record<string, unknown>;
}

export interface Ad {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  adset_id: string;
  campaign_id?: string;
  creative?: AdCreative;
  bid_amount?: number;
  conversion_domain?: string;
  created_time?: string;
  updated_time?: string;
  issues_info?: Array<{ level: string; error_code: number; error_summary: string; error_message: string }>;
  ad_review_feedback?: Record<string, unknown>;
}

export interface InsightAction {
  action_type: string;
  value: string;
}

export interface Insight {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpm?: string;
  cpc?: string;
  frequency?: string;
  actions?: InsightAction[];
  cost_per_action_type?: InsightAction[];
  date_start?: string;
  date_stop?: string;
  account_id?: string;
  account_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
}

export interface AdImage {
  id: string;
  hash?: string;
  name?: string;
  permalink_url?: string;
  url?: string;
  width?: number;
  height?: number;
  created_time?: string;
  status?: string;
}

export interface AdVideo {
  id: string;
  title?: string;
  description?: string;
  status?: Record<string, unknown>;
  created_time?: string;
  updated_time?: string;
  source?: string;
  thumbnails?: {
    data?: Array<{
      uri?: string;
      is_preferred?: boolean;
    }>;
  };
}

export interface CustomAudience {
  id: string;
  name: string;
  subtype?: string;
  description?: string;
  operation_status?: {
    code?: number;
    description?: string;
  };
  time_created?: number;
  retention_days?: number;
  rule?: string | Record<string, unknown>;
  customer_file_source?: string;
  lookalike_spec?: Record<string, unknown>;
  lookalike_audience_ids?: string[];
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
}

export interface LeadgenFormQuestionOption {
  key?: string;
  value?: string;
}

export interface LeadgenFormQuestion {
  key?: string;
  label?: string;
  type?: string;
  id?: string;
  options?: LeadgenFormQuestionOption[];
}

export interface LeadgenForm {
  id: string;
  name?: string;
  status?: string;
  locale?: string;
  follow_up_action_url?: string;
  questions?: LeadgenFormQuestion[];
  tracking_parameters?: Array<{ key?: string; value?: string }>;
  context_card?: Record<string, unknown>;
}

export interface Lead {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: Array<{
    name?: string;
    values?: string[];
  }>;
  platform?: string;
  is_organic?: boolean;
}

export interface AdPreview {
  body?: string;
}

export interface AdsArchiveResult {
  id?: string;
  ad_creation_time?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_snapshot_url?: string;
  page_id?: string;
  page_name?: string;
  publisher_platforms?: string[];
}

export interface CapiEvent {
  event_name: string;
  event_time: number;
  action_source?: string;
  event_source_url?: string;
  event_id?: string;
  user_data?: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
  data_processing_options?: string[];
  data_processing_options_country?: number;
  data_processing_options_state?: number;
}

export interface CapiEventResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
}
