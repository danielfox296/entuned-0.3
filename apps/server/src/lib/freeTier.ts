// Stable UUIDs for the canonical Free Tier singletons. Created by migration
// 20260509000000_store_icp_m2n_and_free_tier_icp; referenced by application
// code that needs to link free Stores into the Free Tier pool.
//
// Hand-curated free-tier songs land as LineageRows with icp_id = FREE_TIER_ICP_ID.
// Every free Store has a StoreICP row pointing to FREE_TIER_ICP_ID.

export const FREE_TIER_CLIENT_ID = '00000000-0000-0000-0000-000000000001'
export const FREE_TIER_ICP_ID = '00000000-0000-0000-0000-000000000002'
