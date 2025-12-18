# OIDC User Synchronization

This guide explains how to configure automatic user synchronization from a Keycloak OIDC provider to Outline.

## Overview

When enabled, Outline will periodically fetch users from your Keycloak server and:

- **Create** new users in Outline before they log in
- **Update** user details (name, email) when they change in Keycloak
- **Suspend** users in Outline when they are removed or disabled in Keycloak
- **Reactivate** suspended users when they reappear in Keycloak

This allows administrators to pre-provision users and manage access centrally through Keycloak.

## Prerequisites

1. A working Keycloak server with OIDC authentication already configured in Outline
2. A Keycloak client with service account access to the Admin API

## Keycloak Configuration

### Option 1: Use Existing OIDC Client

You can reuse your existing OIDC client if you enable service account access:

1. In Keycloak Admin Console, navigate to your realm
2. Go to **Clients** and select your Outline client
3. Under **Settings**, enable:
   - **Client authentication**: On
   - **Service accounts roles**: On
4. Go to **Service Account Roles** tab
5. Click **Assign role**, filter by clients, and assign:
   - `realm-management` -> `view-users` (minimum required)
   - `realm-management` -> `manage-users` (if you want full sync capabilities)

### Option 2: Create Separate Admin Client

For better security separation, create a dedicated client for sync:

1. In Keycloak Admin Console, navigate to your realm
2. Go to **Clients** and click **Create client**
3. Configure the client:
   - **Client ID**: `outline-sync` (or any name you prefer)
   - **Client authentication**: On
   - **Service accounts roles**: On
   - **Standard flow**: Off (not needed for service account)
   - **Direct access grants**: Off
4. Go to **Credentials** tab and copy the client secret
5. Go to **Service Account Roles** tab and assign:
   - `realm-management` -> `view-users`

## Outline Configuration

Add the following environment variables to your Outline deployment:

### Required Variables

```bash
# Enable user synchronization
OIDC_SYNC_ENABLED=true

# Keycloak server base URL (without /auth path for Keycloak 17+)
OIDC_SYNC_ADMIN_URL=https://keycloak.example.com

# The realm name to sync users from
OIDC_SYNC_REALM=myrealm
```

### Optional Variables

```bash
# If using a separate admin client (Option 2 above)
OIDC_SYNC_CLIENT_ID=outline-sync
OIDC_SYNC_CLIENT_SECRET=your-admin-client-secret
```

If `OIDC_SYNC_CLIENT_ID` is not set, Outline will use the main `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` for admin API access.

## Complete Example

Here is a complete example configuration:

```bash
# Standard OIDC authentication
OIDC_CLIENT_ID=outline
OIDC_CLIENT_SECRET=your-client-secret
OIDC_ISSUER_URL=https://keycloak.example.com/realms/myrealm
OIDC_DISPLAY_NAME=Company SSO

# User synchronization
OIDC_SYNC_ENABLED=true
OIDC_SYNC_ADMIN_URL=https://keycloak.example.com
OIDC_SYNC_REALM=myrealm
```

## How It Works

### Sync Schedule

The sync task runs automatically every hour. It:

1. Connects to the Keycloak Admin API using client credentials
2. Fetches all enabled users from the configured realm
3. For each Outline team with OIDC authentication:
   - Creates users that exist in Keycloak but not in Outline
   - Updates user details if they changed in Keycloak
   - Suspends users that no longer exist in Keycloak
   - Reactivates previously suspended users if they reappear

### User Matching

Users are matched between Keycloak and Outline using:

1. **Provider ID**: The Keycloak user ID stored in the authentication record
2. **Email address**: Case-insensitive matching for users without authentication records

### Safety Features

- If Keycloak returns an empty user list, the sync is aborted to prevent accidental mass suspension
- Users are suspended (not deleted) when removed from Keycloak, preserving their data
- Sync errors for individual users do not stop the entire sync process

### New User Defaults

Users created through sync:

- Are assigned the team's default user role (Member, Viewer, etc.)
- Have no password (they must authenticate via OIDC)
- Appear as "invited" until they first log in

## Troubleshooting

### Check Logs

Enable debug logging to see sync activity:

```bash
LOG_LEVEL=debug
```

Look for log entries with the `sync` or `keycloak` category.

### Common Issues

**"Failed to obtain Keycloak admin token"**
- Verify `OIDC_SYNC_ADMIN_URL` is correct (no trailing slash)
- Check that the client ID and secret are correct
- Ensure the client has service account enabled

**"Keycloak Admin API authentication failed"**
- The client lacks the required realm-management roles
- Assign `view-users` role to the service account

**"Provider returned empty user list"**
- Check that users exist in the Keycloak realm
- Verify the realm name in `OIDC_SYNC_REALM` is correct

**Users not being created**
- Ensure users have an email address in Keycloak
- Check that users are enabled in Keycloak

## Security Considerations

1. **Least Privilege**: Only grant `view-users` role if you only need read access
2. **Separate Credentials**: Consider using a dedicated client for sync operations
3. **Network Security**: Ensure the Keycloak Admin API is only accessible from your Outline server
4. **Audit Logs**: Monitor Keycloak audit logs for admin API access

## Limitations

- Only Keycloak is currently supported as an OIDC provider for user sync
- Group synchronization is not yet implemented
- Custom attributes are not synced
- User avatars are not synced (Keycloak Admin API does not expose avatar URLs)
