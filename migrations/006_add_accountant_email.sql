-- Migration 006: Add accountant_email to companies table
-- This allows companies to store their accountant's email for communication

-- Add accountant_email column to companies table
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS accountant_email VARCHAR(255);

-- Add comment to document the column
COMMENT ON COLUMN companies.accountant_email IS 'Email address of the company''s accountant or accounting firm';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_companies_accountant_email ON companies(accountant_email);

-- Verify the column was added
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'companies' 
    AND column_name = 'accountant_email'
  ) THEN
    RAISE NOTICE 'Column accountant_email successfully added to companies table';
  ELSE
    RAISE EXCEPTION 'Failed to add accountant_email column';
  END IF;
END $$;

