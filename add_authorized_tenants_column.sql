-- Add authorized_tenants column to xero_settings table
ALTER TABLE xero_settings 
ADD COLUMN IF NOT EXISTS authorized_tenants JSONB DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN xero_settings.authorized_tenants IS 'Array of Xero tenant objects that this company is authorized to access';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_xero_settings_authorized_tenants ON xero_settings USING GIN (authorized_tenants);
