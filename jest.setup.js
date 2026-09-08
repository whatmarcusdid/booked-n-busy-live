// jest.setup.js
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.DATA_HASH_SECRET = "test-data-hash-secret";
process.env.REAL_SCAN_ENABLED = "false";
delete process.env.BROWSERLESS_API_KEY;
