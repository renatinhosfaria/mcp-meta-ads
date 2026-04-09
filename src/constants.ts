export const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
export const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;
export const CHARACTER_LIMIT = 25000;
export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGINATE_ITEMS = 500;

export const CAMPAIGN_FIELDS = [
  'id', 'name', 'status', 'effective_status', 'objective',
  'daily_budget', 'lifetime_budget', 'budget_remaining', 'spend_cap',
  'bid_strategy', 'buying_type', 'start_time', 'stop_time',
  'created_time', 'updated_time', 'special_ad_categories',
].join(',');

export const ADSET_FIELDS = [
  'id', 'name', 'status', 'effective_status', 'campaign_id',
  'daily_budget', 'lifetime_budget', 'budget_remaining',
  'optimization_goal', 'billing_event', 'bid_amount', 'bid_strategy',
  'targeting', 'start_time', 'end_time',
  'created_time', 'updated_time',
].join(',');

export const AD_FIELDS = [
  'id', 'name', 'status', 'effective_status',
  'adset_id', 'campaign_id', 'creative',
  'bid_amount', 'conversion_domain',
  'created_time', 'updated_time',
  'issues_info', 'ad_review_feedback',
].join(',');

export const AD_ACCOUNT_FIELDS = [
  'id', 'name', 'account_id', 'account_status',
  'currency', 'timezone_name', 'amount_spent',
  'balance', 'business', 'spend_cap',
].join(',');

export const INSIGHT_FIELDS = [
  'spend', 'impressions', 'reach', 'clicks', 'ctr',
  'cpm', 'cpc', 'frequency', 'actions', 'cost_per_action_type',
  'date_start', 'date_stop', 'account_id', 'account_name',
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
  'ad_id', 'ad_name',
].join(',');

export const CAMPAIGN_OBJECTIVES = [
  'OUTCOME_AWARENESS',
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_LEADS',
  'OUTCOME_SALES',
  'OUTCOME_TRAFFIC',
  'OUTCOME_APP_PROMOTION',
] as const;

export const AD_STATUSES = ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED'] as const;
export const LIST_EFFECTIVE_STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED'] as const;

export const DATE_PRESETS = [
  'today', 'yesterday',
  'this_week_sun_today', 'this_week_mon_today',
  'last_week_sun_sat', 'last_week_mon_sun',
  'this_month', 'last_month',
  'this_quarter', 'last_quarter',
  'last_3d', 'last_7d', 'last_14d', 'last_28d', 'last_30d', 'last_90d',
  'last_year', 'this_year', 'maximum',
] as const;

export const INSIGHT_BREAKDOWNS = [
  'age', 'gender', 'country', 'region', 'dma',
  'publisher_platform', 'impression_device', 'device_platform',
  'product_id',
] as const;

export const INSIGHT_LEVELS = ['account', 'campaign', 'adset', 'ad'] as const;

export const AD_IMAGE_FIELDS = [
  'id', 'hash', 'name', 'permalink_url', 'url',
  'width', 'height', 'created_time', 'status',
].join(',');

export const AD_VIDEO_FIELDS = [
  'id', 'title', 'description', 'status',
  'created_time', 'updated_time', 'source',
  'thumbnails',
].join(',');

export const AUDIENCE_FIELDS = [
  'id', 'name', 'subtype', 'description',
  'operation_status', 'time_created', 'retention_days',
  'rule', 'customer_file_source', 'lookalike_spec',
  'lookalike_audience_ids', 'approximate_count_lower_bound',
  'approximate_count_upper_bound',
].join(',');

export const AD_CREATIVE_FIELDS = [
  'id', 'name', 'object_story_spec', 'asset_feed_spec',
  'effective_object_story_id', 'url_tags', 'image_hash',
  'thumbnail_url', 'object_type', 'degrees_of_freedom_spec',
].join(',');

export const LEAD_FORM_FIELDS = [
  'id', 'name', 'status', 'locale',
  'follow_up_action_url', 'questions',
  'tracking_parameters', 'context_card',
].join(',');

export const LEAD_FIELDS = [
  'id', 'created_time', 'ad_id',
  'form_id', 'field_data', 'platform',
  'is_organic',
].join(',');

export const AD_LIBRARY_FIELDS = [
  'id', 'ad_creation_time', 'ad_delivery_start_time',
  'ad_delivery_stop_time', 'ad_snapshot_url',
  'page_id', 'page_name', 'publisher_platforms',
].join(',');

export const DEFAULT_PREVIEW_FIELDS = 'body';
