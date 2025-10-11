-- Create INSTEAD OF triggers for plug_and_play_xero_settings view
-- These triggers allow the view to behave like a table for INSERT/UPDATE/DELETE operations

-- Trigger for INSERT operations
CREATE OR REPLACE FUNCTION plug_and_play_xero_settings_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert or update client credentials in xero_oauth_settings
  INSERT INTO xero_oauth_settings (
    company_id,
    client_id,
    client_secret,
    redirect_uri,
    created_at,
    updated_at
  ) VALUES (
    NEW.company_id,
    NEW.client_id,
    NEW.client_secret,
    NEW.redirect_uri,
    COALESCE(NEW.created_at, NOW()),
    COALESCE(NEW.updated_at, NOW())
  )
  ON CONFLICT (company_id) DO UPDATE SET
    client_id = EXCLUDED.client_id,
    client_secret = EXCLUDED.client_secret,
    redirect_uri = EXCLUDED.redirect_uri,
    updated_at = EXCLUDED.updated_at;

  -- If access token is provided, also insert/update in xero_connections
  IF NEW.access_token IS NOT NULL THEN
    INSERT INTO xero_connections (
      company_id,
      tenant_id,
      tenant_name,
      access_token_encrypted,
      refresh_token_encrypted,
      access_token_expires_at,
      status,
      created_by,
      created_at,
      updated_at,
      client_id,
      client_secret,
      redirect_uri,
      authorized_tenants,
      selected_tenant_id,
      primary_organization_name,
      xero_user_id,
      last_sync_at,
      token_created_at
    ) VALUES (
      NEW.company_id,
      COALESCE(NEW.tenant_id, ''),
      COALESCE(NEW.organization_name, 'Organization'),
      NEW.access_token,
      NEW.refresh_token,
      NEW.token_expires_at,
      COALESCE(NEW.sync_status, 'active'),
      1, -- default created_by user ID
      COALESCE(NEW.created_at, NOW()),
      COALESCE(NEW.updated_at, NOW()),
      NEW.client_id,
      NEW.client_secret,
      NEW.redirect_uri,
      COALESCE(NEW.tenant_data, '[]'::jsonb),
      NEW.tenant_id,
      NEW.organization_name,
      NULL,
      NEW.last_sync_at,
      COALESCE(NEW.created_at, NOW())
    )
    ON CONFLICT (company_id) DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id,
      tenant_name = EXCLUDED.tenant_name,
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      access_token_expires_at = EXCLUDED.access_token_expires_at,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at,
      client_id = EXCLUDED.client_id,
      client_secret = EXCLUDED.client_secret,
      redirect_uri = EXCLUDED.redirect_uri,
      authorized_tenants = EXCLUDED.authorized_tenants,
      selected_tenant_id = EXCLUDED.selected_tenant_id,
      primary_organization_name = EXCLUDED.primary_organization_name,
      last_sync_at = EXCLUDED.last_sync_at;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for UPDATE operations
CREATE OR REPLACE FUNCTION plug_and_play_xero_settings_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Update client credentials in xero_oauth_settings
  IF NEW.client_id IS NOT NULL OR NEW.client_secret IS NOT NULL OR NEW.redirect_uri IS NOT NULL THEN
    UPDATE xero_oauth_settings SET
      client_id = COALESCE(NEW.client_id, OLD.client_id),
      client_secret = COALESCE(NEW.client_secret, OLD.client_secret),
      redirect_uri = COALESCE(NEW.redirect_uri, OLD.redirect_uri),
      updated_at = NOW()
    WHERE company_id = NEW.company_id;
    
    -- If no row was updated, insert it
    IF NOT FOUND THEN
      INSERT INTO xero_oauth_settings (
        company_id,
        client_id,
        client_secret,
        redirect_uri,
        created_at,
        updated_at
      ) VALUES (
        NEW.company_id,
        NEW.client_id,
        NEW.client_secret,
        NEW.redirect_uri,
        NOW(),
        NOW()
      );
    END IF;
  END IF;

  -- Update tokens in xero_connections if provided
  IF NEW.access_token IS NOT NULL OR NEW.refresh_token IS NOT NULL OR NEW.tenant_id IS NOT NULL THEN
    UPDATE xero_connections SET
      tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id, ''),
      tenant_name = COALESCE(NEW.organization_name, OLD.organization_name, 'Organization'),
      access_token_encrypted = COALESCE(NEW.access_token, OLD.access_token, access_token_encrypted),
      refresh_token_encrypted = COALESCE(NEW.refresh_token, OLD.refresh_token, refresh_token_encrypted),
      access_token_expires_at = COALESCE(NEW.token_expires_at, OLD.token_expires_at, access_token_expires_at),
      status = COALESCE(NEW.sync_status, OLD.sync_status, 'active'),
      updated_at = NOW(),
      client_id = COALESCE(NEW.client_id, OLD.client_id, client_id),
      client_secret = COALESCE(NEW.client_secret, OLD.client_secret, client_secret),
      redirect_uri = COALESCE(NEW.redirect_uri, OLD.redirect_uri, redirect_uri),
      authorized_tenants = COALESCE(NEW.tenant_data, OLD.tenant_data, authorized_tenants),
      selected_tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id, selected_tenant_id),
      primary_organization_name = COALESCE(NEW.organization_name, OLD.organization_name, primary_organization_name),
      last_sync_at = COALESCE(NEW.last_sync_at, OLD.last_sync_at, last_sync_at)
    WHERE company_id = NEW.company_id;
    
    -- If no row was updated, insert it
    IF NOT FOUND THEN
      INSERT INTO xero_connections (
        company_id,
        tenant_id,
        tenant_name,
        access_token_encrypted,
        refresh_token_encrypted,
        access_token_expires_at,
        status,
        created_by,
        created_at,
        updated_at,
        client_id,
        client_secret,
        redirect_uri,
        authorized_tenants,
        selected_tenant_id,
        primary_organization_name,
        last_sync_at,
        token_created_at
      ) VALUES (
        NEW.company_id,
        COALESCE(NEW.tenant_id, ''),
        COALESCE(NEW.organization_name, 'Organization'),
        NEW.access_token,
        NEW.refresh_token,
        NEW.token_expires_at,
        COALESCE(NEW.sync_status, 'active'),
        1, -- default created_by user ID
        NOW(),
        NOW(),
        NEW.client_id,
        NEW.client_secret,
        NEW.redirect_uri,
        COALESCE(NEW.tenant_data, '[]'::jsonb),
        NEW.tenant_id,
        NEW.organization_name,
        NEW.last_sync_at,
        NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for DELETE operations
CREATE OR REPLACE FUNCTION plug_and_play_xero_settings_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete from both tables
  DELETE FROM xero_connections WHERE company_id = OLD.company_id;
  DELETE FROM xero_oauth_settings WHERE company_id = OLD.company_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS plug_and_play_xero_settings_insert_trigger ON plug_and_play_xero_settings;
DROP TRIGGER IF EXISTS plug_and_play_xero_settings_update_trigger ON plug_and_play_xero_settings;
DROP TRIGGER IF EXISTS plug_and_play_xero_settings_delete_trigger ON plug_and_play_xero_settings;

-- Create the INSTEAD OF triggers
CREATE TRIGGER plug_and_play_xero_settings_insert_trigger
INSTEAD OF INSERT ON plug_and_play_xero_settings
FOR EACH ROW
EXECUTE FUNCTION plug_and_play_xero_settings_insert();

CREATE TRIGGER plug_and_play_xero_settings_update_trigger
INSTEAD OF UPDATE ON plug_and_play_xero_settings
FOR EACH ROW
EXECUTE FUNCTION plug_and_play_xero_settings_update();

CREATE TRIGGER plug_and_play_xero_settings_delete_trigger
INSTEAD OF DELETE ON plug_and_play_xero_settings
FOR EACH ROW
EXECUTE FUNCTION plug_and_play_xero_settings_delete();

COMMENT ON FUNCTION plug_and_play_xero_settings_insert() IS 'Handle INSERT operations on plug_and_play_xero_settings view';
COMMENT ON FUNCTION plug_and_play_xero_settings_update() IS 'Handle UPDATE operations on plug_and_play_xero_settings view';
COMMENT ON FUNCTION plug_and_play_xero_settings_delete() IS 'Handle DELETE operations on plug_and_play_xero_settings view';

